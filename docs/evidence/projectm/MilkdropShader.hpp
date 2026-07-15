/**
 * Retained from github.com/projectM-visualizer/projectm
 * src/libprojectM/MilkdropPreset/MilkdropShader.hpp
 * Retrieved 2026-07-15 for PHOSPHENE compatibility evidence.
 */
#pragma once

#include "BlurTexture.hpp"

#include <Renderer/Shader.hpp>
#include <Renderer/TextureManager.hpp>

#include <array>
#include <set>

namespace libprojectM {
namespace MilkdropPreset {

class PerFrameContext;
class PresetState;

class MilkdropShader
{
public:
    enum class ShaderType
    {
        WarpShader,     // Warp shader — separate shader-instance rand_preset ownership
        CompositeShader // Composite shader — separate shader-instance rand_preset ownership
    };

    explicit MilkdropShader(ShaderType type);

    void LoadCode(const std::string& presetShaderCode);
    void LoadTexturesAndCompile(PresetState& presetState);
    void LoadVariables(const PresetState& presetState, const PerFrameContext& perFrameContext);
    auto Shader() -> Renderer::Shader&;

private:
    void PreprocessPresetShader(std::string& program);
    void GetReferencedSamplers(const std::string& program);
    void TranspileHLSLShader(const PresetState& presetState, std::string& program);
    void UpdateMaxBlurLevel(BlurTexture::BlurLevel requestedLevel);

    ShaderType m_type{ShaderType::WarpShader};
    std::string m_fragmentShaderCode;
    std::string m_preprocessedCode;

    std::set<std::string> m_samplerNames;
    std::vector<Renderer::TextureSamplerDescriptor> m_mainTextureDescriptors;
    std::vector<Renderer::TextureSamplerDescriptor> m_textureSamplerDescriptors;
    BlurTexture::BlurLevel m_maxBlurLevelRequired{BlurTexture::BlurLevel::None};

    // Persistent random state — set once per shader instance.
    std::array<float, 4> m_randValues{};                // rand_preset
    std::array<glm::vec3, 20> m_randTranslation{};      // Persistent random translation vectors (first 20 matrices)
    std::array<glm::vec3, 20> m_randRotationCenters{};  // Persistent rotation center vectors
    std::array<glm::vec3, 20> m_randRotationSpeeds{};   // Persistent rotation speeds

    Renderer::Shader m_shader;
};

} // namespace MilkdropPreset
} // namespace libprojectM
