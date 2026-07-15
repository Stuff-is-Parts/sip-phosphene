/**
 * projectM -- Milkdrop-esque visualisation SDK
 * Copyright (C)2003-2004 projectM Team
 *
 * Retained from github.com/projectM-visualizer/projectm
 * src/libprojectM/MilkdropPreset/MilkdropPreset.cpp
 * Retrieved 2026-07-15 for PHOSPHENE compatibility evidence.
 *
 * See 'LICENSE.txt' included within the projectM release.
 */

#include "MilkdropPreset.hpp"

#include "Factory.hpp"
#include "MilkdropPresetExceptions.hpp"
#include "PresetFileParser.hpp"

#include <Logging.hpp>

namespace libprojectM {
namespace MilkdropPreset {

MilkdropPreset::MilkdropPreset(const std::string& absoluteFilePath)
    : m_absoluteFilePath(absoluteFilePath)
    , m_perFrameContext(m_state.globalMemory, &m_state.globalRegisters)
    , m_perPixelContext(m_state.globalMemory, &m_state.globalRegisters)
    , m_motionVectors(m_state)
    , m_waveform(m_state)
    , m_darkenCenter(m_state)
    , m_border(m_state)
{
    Load(absoluteFilePath);
}

MilkdropPreset::MilkdropPreset(std::istream& presetData)
    : m_perFrameContext(m_state.globalMemory, &m_state.globalRegisters)
    , m_perPixelContext(m_state.globalMemory, &m_state.globalRegisters)
    , m_motionVectors(m_state)
    , m_waveform(m_state)
    , m_darkenCenter(m_state)
    , m_border(m_state)
{
    Load(presetData);
}

void MilkdropPreset::Initialize(const Renderer::RenderContext& renderContext)
{
    assert(renderContext.textureManager);
    m_state.renderContext = renderContext;
    m_state.blurTexture.Initialize(renderContext);
    m_state.LoadShaders();

    CompileCodeAndRunInitExpressions();

    m_framebuffer.SetSize(renderContext.viewportSizeX, renderContext.viewportSizeY);
    m_motionVectorUVMap->SetSize(renderContext.viewportSizeX, renderContext.viewportSizeY);
    if (m_state.mainTexture.expired())
    {
        m_state.mainTexture = m_framebuffer.GetColorAttachmentTexture(1, 0);
    }

    m_perPixelMesh.CompileWarpShader(m_state);
    m_finalComposite.CompileCompositeShader(m_state);
}

void MilkdropPreset::RenderFrame(const libprojectM::Audio::FrameAudioData& audioData, const Renderer::RenderContext& renderContext)
{
    m_state.audioData = audioData;
    m_state.renderContext = renderContext;

    if (m_framebuffer.SetSize(renderContext.viewportSizeX, renderContext.viewportSizeY))
    {
        m_motionVectorUVMap->SetSize(renderContext.viewportSizeX, renderContext.viewportSizeY);
        m_isFirstFrame = true;
    }

    m_state.mainTexture = m_framebuffer.GetColorAttachmentTexture(m_previousFrameBuffer, 0);

    PerFrameUpdate();

    glViewport(0, 0, renderContext.viewportSizeX, renderContext.viewportSizeY);

    m_framebuffer.Bind(m_previousFrameBuffer);
    // Motion vector field. Drawn to the previous frame texture BEFORE warping it.
    if (!m_isFirstFrame)
    {
        m_motionVectors.Draw(m_perFrameContext, m_motionVectorUVMap->Texture());
    }

    // y-flip the previous frame and assign the flipped texture as "main"
    m_flipTexture.Draw(*renderContext.shaderCache, m_framebuffer.GetColorAttachmentTexture(m_previousFrameBuffer, 0), nullptr, true, false);
    m_state.mainTexture = m_flipTexture.Texture();

    // Draw to current framebuffer.
    m_framebuffer.Bind(m_currentFrameBuffer);

    m_framebuffer.SetAttachment(m_currentFrameBuffer, 1, m_motionVectorUVMap);

    // Draw previous frame image warped via per-pixel mesh and warp shader
    m_perPixelMesh.Draw(m_state, m_perFrameContext, m_perPixelContext);

    m_framebuffer.RemoveColorAttachment(m_currentFrameBuffer, 1);

    // Update blur textures
    {
        const auto warpedImage = m_framebuffer.GetColorAttachmentTexture(m_previousFrameBuffer, 0);
        assert(warpedImage.get());
        m_state.blurTexture.Update(*warpedImage, m_perFrameContext);
    }

    // Draw audio-data-related stuff
    for (auto& shape : m_customShapes)
    {
        shape->Draw();
    }
    for (auto& wave : m_customWaveforms)
    {
        wave->Draw(m_perFrameContext);
    }
    m_waveform.Draw(m_perFrameContext);

    if (*m_perFrameContext.darken_center > 0)
    {
        m_darkenCenter.Draw();
    }
    m_border.Draw(m_perFrameContext);

    // y-flip the image for final compositing again
    m_flipTexture.Draw(*renderContext.shaderCache, m_framebuffer.GetColorAttachmentTexture(m_currentFrameBuffer, 0), nullptr, true, false);
    m_state.mainTexture = m_flipTexture.Texture();

    m_framebuffer.BindRead(m_currentFrameBuffer);
    m_framebuffer.BindDraw(m_previousFrameBuffer);

    m_finalComposite.Draw(m_state, m_perFrameContext);

    if (!m_finalComposite.HasCompositeShader())
    {
        m_flipTexture.Draw(*renderContext.shaderCache, m_framebuffer.GetColorAttachmentTexture(m_previousFrameBuffer, 0), m_framebuffer, m_previousFrameBuffer, true, false);
    }

    // Swap framebuffer IDs for the next frame.
    std::swap(m_currentFrameBuffer, m_previousFrameBuffer);

    m_isFirstFrame = false;
}

void MilkdropPreset::PerFrameUpdate()
{
    m_perFrameContext.LoadStateVariables(m_state);
    m_perPixelContext.LoadStateReadOnlyVariables(m_state, m_perFrameContext);

    m_perFrameContext.ExecutePerFrameCode();

    m_perPixelContext.LoadPerFrameQVariables(m_state, m_perFrameContext);

    *m_perFrameContext.gamma = std::max(0.0, std::min(8.0, *m_perFrameContext.gamma));
    *m_perFrameContext.echo_zoom = std::max(0.001, std::min(1000.0, *m_perFrameContext.echo_zoom));
}

} // namespace MilkdropPreset
} // namespace libprojectM
