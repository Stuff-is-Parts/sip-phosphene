/**
 * Retained from github.com/projectM-visualizer/projectm
 * src/libprojectM/Renderer/MilkdropNoise.hpp
 * Retrieved 2026-07-15 for PHOSPHENE compatibility evidence.
 */
#pragma once

#include <Renderer/Texture.hpp>

#include <cstdint>
#include <memory>
#include <vector>

namespace libprojectM {
namespace Renderer {

class MilkdropNoise
{
public:
    MilkdropNoise() = delete;

    // 2D noise textures.
    static auto LowQuality() -> std::shared_ptr<Texture>;       // noise_lq — 256, zoom 1
    static auto LowQualityLite() -> std::shared_ptr<Texture>;   // noise_lq_lite — 32, zoom 1
    static auto MediumQuality() -> std::shared_ptr<Texture>;    // noise_mq — 256, zoom 4
    static auto HighQuality() -> std::shared_ptr<Texture>;      // noise_hq — 256, zoom 8

    // 3D noise textures.
    static auto LowQualityVolume() -> std::shared_ptr<Texture>; // noisevol_lq — 32, zoom 1
    static auto HighQualityVolume() -> std::shared_ptr<Texture>;// noisevol_hq — 32, zoom 4

protected:
    static auto GetPreferredInternalFormat() -> int;
    static auto generate2D(int size, int zoomFactor) -> std::vector<uint32_t>;
    static auto generate3D(int size, int zoomFactor) -> std::vector<uint32_t>;
    static float fCubicInterpolate(float y0, float y1, float y2, float y3, float t);
    static uint32_t dwCubicInterpolate(uint32_t y0, uint32_t y1, uint32_t y2, uint32_t y3, float t);
};

} // namespace Renderer
} // namespace libprojectM
