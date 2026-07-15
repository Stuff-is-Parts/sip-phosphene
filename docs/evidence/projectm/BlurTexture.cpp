/**
 * Retained from github.com/projectM-visualizer/projectm
 * src/libprojectM/MilkdropPreset/BlurTexture.cpp
 * Retrieved 2026-07-15 for PHOSPHENE compatibility evidence.
 */

#include "BlurTexture.hpp"

#include "PerFrameContext.hpp"
#include "PresetState.hpp"

#include "MilkdropStaticShaders.hpp"

#include <Renderer/BlendMode.hpp>
#include <Renderer/Point.hpp>
#include <Renderer/ShaderCache.hpp>

#include <array>

namespace libprojectM {
namespace MilkdropPreset {

BlurTexture::BlurTexture()
    : m_blurMesh(Renderer::VertexBufferUsage::StaticDraw, false, true)
    , m_blurSampler(std::make_shared<Renderer::Sampler>(GL_CLAMP_TO_EDGE, GL_LINEAR))
{
    m_blurFramebuffer.CreateColorAttachment(0, 0);
    m_blurMesh.SetRenderPrimitiveType(Renderer::Mesh::PrimitiveType::TriangleStrip);
    m_blurMesh.Vertices().Set({{-1.0f, -1.0f}, {1.0f, -1.0f}, {-1.0f, 1.0f}, {1.0f, 1.0f}});
    m_blurMesh.UVs().Set({{0.0, 0.0}, {1.0, 0.0}, {0.0, 1.0}, {1.0, 1.0}});
    m_blurMesh.Update();

    for (size_t i = 0; i < m_blurTextures.size(); i++)
    {
        std::string textureName;
        if (i % 2 == 1)
        {
            textureName = "blur" + std::to_string(i / 2 + 1);
        }
        m_blurTextures[i] = std::make_shared<Renderer::Texture>(textureName, 0, GL_TEXTURE_2D, 0, 0, false);
    }
}

void BlurTexture::Update(const Renderer::Texture& sourceTexture, const PerFrameContext& perFrameContext)
{
    if (m_blurLevel == BlurLevel::None) return;
    if (sourceTexture.Width() == 0 || sourceTexture.Height() == 0) return;

    AllocateTextures(sourceTexture);

    unsigned int const passes = static_cast<int>(m_blurLevel) * 2;
    auto const blur1EdgeDarken = static_cast<float>(*perFrameContext.blur1_edge_darken);

    const std::array<float, 8> weights = {4.0f, 3.8f, 3.5f, 2.9f, 1.9f, 1.2f, 0.7f, 0.3f};

    Values blurMin;
    Values blurMax;
    GetSafeBlurMinMaxValues(perFrameContext, blurMin, blurMax);

    std::array<float, 3> scale{};
    std::array<float, 3> bias{};

    // Progressive scale/bias to map one [min..max] range to the next.
    scale[0] = 1.0f / (blurMax[0] - blurMin[0]);
    bias[0] = -blurMin[0] * scale[0];
    float tempMin = (blurMin[1] - blurMin[0]) / (blurMax[0] - blurMin[0]);
    float tempMax = (blurMax[1] - blurMin[0]) / (blurMax[0] - blurMin[0]);
    scale[1] = 1.0f / (tempMax - tempMin);
    bias[1] = -tempMin * scale[1];
    tempMin = (blurMin[2] - blurMin[1]) / (blurMax[1] - blurMin[1]);
    tempMax = (blurMax[2] - blurMin[1]) / (blurMax[1] - blurMin[1]);
    scale[2] = 1.0f / (tempMax - tempMin);
    bias[2] = -tempMin * scale[2];

    m_blurFramebuffer.Bind(0);
    Renderer::BlendMode::Set(true, Renderer::BlendMode::Function::One, Renderer::BlendMode::Function::Zero);

    // Six sequential passes: pairs of (H, V). Pass 0 = first H (reads sourceTexture, vertical flip on!).
    for (unsigned int pass = 0; pass < passes; pass++)
    {
        if (m_blurTextures[pass]->TextureID() == 0) continue;

        std::shared_ptr<Renderer::Shader> blurShader;
        if ((pass % 2) == 0) blurShader = m_blur1Shader.lock();
        else                 blurShader = m_blur2Shader.lock();
        if (!blurShader) return;

        blurShader->Bind();
        blurShader->SetUniformInt("texture_sampler", 0);

        glViewport(0, 0, m_blurTextures[pass]->Width(), m_blurTextures[pass]->Height());

        // Pass 0 reads the source; subsequent passes chain through the previous target.
        if (pass == 0)
        {
            sourceTexture.Bind(0);
            blurShader->SetUniformInt("flipVertical", 1);
        }
        else
        {
            m_blurTextures[pass - 1]->Bind(0);
            blurShader->SetUniformInt("flipVertical", 0);
        }
        m_blurSampler->Bind(0);

        float srcWidth = static_cast<float>((pass == 0) ? sourceTexture.Width() : m_blurTextures[pass - 1]->Width());
        float srcHeight = static_cast<float>((pass == 0) ? sourceTexture.Height() : m_blurTextures[pass - 1]->Height());

        float scaleNow = scale[pass / 2];
        float biasNow = bias[pass / 2];

        if (pass % 2 == 0)
        {
            // Horizontal 8-tap pass.
            const float w1 = weights[0] + weights[1];
            const float w2 = weights[2] + weights[3];
            const float w3 = weights[4] + weights[5];
            const float w4 = weights[6] + weights[7];
            const float d1 = 0 + 2 * weights[1] / w1;
            const float d2 = 2 + 2 * weights[3] / w2;
            const float d3 = 4 + 2 * weights[5] / w3;
            const float d4 = 6 + 2 * weights[7] / w4;
            const float w_div = 0.5f / (w1 + w2 + w3 + w4);
            blurShader->SetUniformFloat4("_c0", {srcWidth, srcHeight, 1.0f / srcWidth, 1.0f / srcHeight});
            blurShader->SetUniformFloat4("_c1", {w1, w2, w3, w4});
            blurShader->SetUniformFloat4("_c2", {d1, d2, d3, d4});
            blurShader->SetUniformFloat4("_c3", {scaleNow, biasNow, w_div, 0.0});
        }
        else
        {
            // Vertical 4-tap pass — edge darken ONLY on pass 1 (first V pass).
            const float w1 = weights[0] + weights[1] + weights[2] + weights[3];
            const float w2 = weights[4] + weights[5] + weights[6] + weights[7];
            const float d1 = 0 + 2 * ((weights[2] + weights[3]) / w1);
            const float d2 = 2 + 2 * ((weights[6] + weights[7]) / w2);
            const float w_div = 1.0f / ((w1 + w2) * 2);
            blurShader->SetUniformFloat4("_c0", {srcWidth, srcHeight, 1.0f / srcWidth, 1.0f / srcHeight});
            blurShader->SetUniformFloat4("_c5", {w1, w2, d1, d2});
            if (pass == 1)
            {
                blurShader->SetUniformFloat4("_c6", {w_div, (1 - blur1EdgeDarken), blur1EdgeDarken, 5.0f});
            }
            else
            {
                blurShader->SetUniformFloat4("_c6", {w_div, 1.0f, 0.0f, 5.0f});
            }
        }

        m_blurMesh.Draw();

        // Copy the framebuffer output into the target texture.
        m_blurTextures[pass]->Bind(0);
        glCopyTexSubImage2D(GL_TEXTURE_2D, 0, 0, 0, 0, 0, m_blurTextures[pass]->Width(), m_blurTextures[pass]->Height());
        m_blurTextures[pass]->Unbind(0);
    }
}

void BlurTexture::Bind(GLint& unit, Renderer::Shader& shader) const
{
    // Only ODD-indexed (vertical) outputs are exposed to shaders as sampler_blur1/2/3.
    for (size_t i = 0; i < static_cast<size_t>(m_blurLevel) * 2; i++)
    {
        if (i % 2 == 1)
        {
            m_blurTextures[i]->Bind(unit, m_blurSampler);
            shader.SetUniformInt(std::string("sampler_blur" + std::to_string(i / 2 + 1)).c_str(), unit);
            unit++;
        }
    }
}

void BlurTexture::GetSafeBlurMinMaxValues(const PerFrameContext& perFrameContext,
                                          Values& blurMin, Values& blurMax)
{
    blurMin[0] = static_cast<float>(*perFrameContext.blur1_min);
    blurMin[1] = static_cast<float>(*perFrameContext.blur2_min);
    blurMin[2] = static_cast<float>(*perFrameContext.blur3_min);
    blurMax[0] = static_cast<float>(*perFrameContext.blur1_max);
    blurMax[1] = static_cast<float>(*perFrameContext.blur2_max);
    blurMax[2] = static_cast<float>(*perFrameContext.blur3_max);

    const float fMinDist = 0.1f;
    if (blurMax[0] - blurMin[0] < fMinDist)
    {
        float avg = (blurMin[0] + blurMax[0]) * 0.5f;
        blurMin[0] = avg - fMinDist * 0.5f;
        blurMax[0] = avg - fMinDist * 0.5f;
    }
    blurMax[1] = std::min(blurMax[0], blurMax[1]);
    blurMin[1] = std::max(blurMin[0], blurMin[1]);
    if (blurMax[1] - blurMin[1] < fMinDist)
    {
        float avg = (blurMin[1] + blurMax[1]) * 0.5f;
        blurMin[1] = avg - fMinDist * 0.5f;
        blurMax[1] = avg - fMinDist * 0.5f;
    }
    blurMax[2] = std::min(blurMax[1], blurMax[2]);
    blurMin[2] = std::max(blurMin[1], blurMin[2]);
    if (blurMax[2] - blurMin[2] < fMinDist)
    {
        float avg = (blurMin[2] + blurMax[2]) * 0.5f;
        blurMin[2] = avg - fMinDist * 0.5f;
        blurMax[2] = avg - fMinDist * 0.5f;
    }
}

void BlurTexture::AllocateTextures(const Renderer::Texture& sourceTexture)
{
    int width = sourceTexture.Width();
    int height = sourceTexture.Height();

    if (m_blurTextures[0] != nullptr && width > 0 && height > 0 &&
        width == m_sourceTextureWidth && height == m_sourceTextureHeight)
    {
        return;
    }

    // Iterative halving with per-pass rounding: X → multiple of 16, Y → multiple of 4.
    // Blur pairs: i=0 (H1) i=1 (V1 = "blur1"), i=2 (H2) i=3 (V2 = "blur2"), i=4 (H3) i=5 (V3 = "blur3").
    // Only i=0 and every EVEN (H) index halves; odd (V) index reuses the H's dims from that pair.
    for (size_t i = 0; i < m_blurTextures.size(); i++)
    {
        if (!(i & 1) || (i < 2))
        {
            width = std::max(16, width / 2);
            height = std::max(16, height / 2);
        }
        int width2 = ((width + 3) / 16) * 16;
        int height2 = ((height + 3) / 4) * 4;

        if (i == 0)
        {
            m_blurFramebuffer.SetSize(width2, height2);
        }

        std::string textureName;
        if (i % 2 == 1)
        {
            textureName = "blur" + std::to_string(i / 2 + 1);
        }
        m_blurTextures[i] = std::make_shared<Renderer::Texture>(textureName, width2, height2, false);
    }

    m_sourceTextureWidth = sourceTexture.Width();
    m_sourceTextureHeight = sourceTexture.Height();
}

} // namespace MilkdropPreset
} // namespace libprojectM
