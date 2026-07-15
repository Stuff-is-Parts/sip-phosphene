/**
 * Retained from github.com/projectM-visualizer/projectm
 * src/libprojectM/MilkdropPreset/BlurTexture.hpp
 * Retrieved 2026-07-15 for PHOSPHENE compatibility evidence.
 */
#pragma once

#include <Renderer/Framebuffer.hpp>
#include <Renderer/Mesh.hpp>
#include <Renderer/RenderContext.hpp>
#include <Renderer/Shader.hpp>
#include <Renderer/TextureSamplerDescriptor.hpp>

#include <array>
#include <memory>

namespace libprojectM {
namespace MilkdropPreset {

class PerFrameContext;
class PresetState;

class BlurTexture
{
public:
    using Values = std::array<float, 3>;

    enum class BlurLevel : int
    {
        None,  // No blur used.
        Blur1, // 2 passes (H1 + V1)
        Blur2, // 4 passes (H1 + V1 + H2 + V2)
        Blur3  // 6 passes (H1 + V1 + H2 + V2 + H3 + V3)
    };

    BlurTexture();
    virtual ~BlurTexture() = default;

    void Initialize(const Renderer::RenderContext& renderContext);
    void SetRequiredBlurLevel(BlurLevel level);
    auto GetDescriptorsForBlurLevel(BlurLevel blurLevel) const -> std::vector<Renderer::TextureSamplerDescriptor>;
    void Update(const Renderer::Texture& sourceTexture, const PerFrameContext& perFrameContext);
    void Bind(GLint& unit, Renderer::Shader& shader) const;

    static void GetSafeBlurMinMaxValues(const PerFrameContext& perFrameContext,
                                        Values& blurMin, Values& blurMax);

private:
    static constexpr int NumBlurTextures = 6; // Six sequential targets.

    void AllocateTextures(const Renderer::Texture& sourceTexture);

    Renderer::Mesh m_blurMesh;

    std::weak_ptr<Renderer::Shader> m_blur1Shader; // Horizontal 8-tap
    std::weak_ptr<Renderer::Shader> m_blur2Shader; // Vertical 4-tap

    int m_sourceTextureWidth{};
    int m_sourceTextureHeight{};

    Renderer::Framebuffer m_blurFramebuffer;
    std::shared_ptr<Renderer::Sampler> m_blurSampler;
    std::array<std::shared_ptr<Renderer::Texture>, NumBlurTextures> m_blurTextures;
    BlurLevel m_blurLevel{BlurLevel::None};
};

} // namespace MilkdropPreset
} // namespace libprojectM
