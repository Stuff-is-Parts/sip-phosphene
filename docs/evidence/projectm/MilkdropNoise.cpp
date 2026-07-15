/**
 * Retained from github.com/projectM-visualizer/projectm
 * src/libprojectM/Renderer/MilkdropNoise.cpp
 * Retrieved 2026-07-15 for PHOSPHENE compatibility evidence.
 */

#include "Renderer/MilkdropNoise.hpp"

#include "Renderer/OpenGL.h"
#include "Renderer/Texture.hpp"

#include <chrono>
#include <memory>
#include <random>

namespace libprojectM {
namespace Renderer {

auto MilkdropNoise::LowQuality() -> std::shared_ptr<Texture>
{
    return std::make_shared<Texture>("noise_lq", generate2D(256, 1).data(), GL_TEXTURE_2D, 256, 256, 0, GL_RGBA8, GetPreferredInternalFormat(), GL_UNSIGNED_BYTE, false);
}
auto MilkdropNoise::LowQualityLite() -> std::shared_ptr<Texture>
{
    return std::make_shared<Texture>("noise_lq_lite", generate2D(32, 1).data(), GL_TEXTURE_2D, 32, 32, 0, GL_RGBA8, GetPreferredInternalFormat(), GL_UNSIGNED_BYTE, false);
}
auto MilkdropNoise::MediumQuality() -> std::shared_ptr<Texture>
{
    return std::make_shared<Texture>("noise_mq", generate2D(256, 4).data(), GL_TEXTURE_2D, 256, 256, 0, GL_RGBA8, GetPreferredInternalFormat(), GL_UNSIGNED_BYTE, false);
}
auto MilkdropNoise::HighQuality() -> std::shared_ptr<Texture>
{
    return std::make_shared<Texture>("noise_hq", generate2D(256, 8).data(), GL_TEXTURE_2D, 256, 256, 0, GL_RGBA8, GetPreferredInternalFormat(), GL_UNSIGNED_BYTE, false);
}
auto MilkdropNoise::LowQualityVolume() -> std::shared_ptr<Texture>
{
    return std::make_shared<Texture>("noisevol_lq", generate3D(32, 1).data(), GL_TEXTURE_3D, 32, 32, 32, GL_RGBA8, GetPreferredInternalFormat(), GL_UNSIGNED_BYTE, false);
}
auto MilkdropNoise::HighQualityVolume() -> std::shared_ptr<Texture>
{
    return std::make_shared<Texture>("noisevol_hq", generate3D(32, 4).data(), GL_TEXTURE_3D, 32, 32, 32, GL_RGBA8, GetPreferredInternalFormat(), GL_UNSIGNED_BYTE, false);
}

auto MilkdropNoise::generate2D(int size, int zoomFactor) -> std::vector<uint32_t>
{
    // INDEPENDENT RNG per generate2D call. Does not consume or shift the preset equation RNG stream.
    uint32_t randomSeed = static_cast<uint32_t>(std::chrono::system_clock::now().time_since_epoch().count());
    std::default_random_engine randomGenerator(randomSeed);
    std::uniform_int_distribution<int> randomDistribution(0, INT32_MAX);

    std::vector<uint32_t> textureData;
    textureData.resize(size * size);

    auto dst = textureData.data();
    auto RANGE = (zoomFactor > 1) ? 216 : 256;
    for (auto y = 0; y < size; y++)
    {
        // 4-channel packed pixels, each channel = (rand%RANGE) + RANGE/2.
        for (auto x = 0; x < size; x++)
        {
            dst[x] = (static_cast<uint32_t>((randomDistribution(randomGenerator) % RANGE) + RANGE / 2) << 24) |
                     (static_cast<uint32_t>((randomDistribution(randomGenerator) % RANGE) + RANGE / 2) << 16) |
                     (static_cast<uint32_t>((randomDistribution(randomGenerator) % RANGE) + RANGE / 2) << 8) |
                     (static_cast<uint32_t>((randomDistribution(randomGenerator) % RANGE) + RANGE / 2));
        }
        // PROJECTM-DISTINCTIVE STEP: swap `size` random pixel-pairs per row for extra randomness.
        for (auto x = 0; x < size; x++)
        {
            auto x1 = randomDistribution(randomGenerator) % size;
            auto x2 = randomDistribution(randomGenerator) % size;
            auto temp = dst[x2];
            dst[x2] = dst[x1];
            dst[x1] = temp;
        }
        dst += size;
    }

    // Cubic-interpolate lattice points at zoom > 1.
    if (zoomFactor > 1)
    {
        dst = textureData.data();

        // First across (X) on lattice rows.
        for (auto y = 0; y < size; y += zoomFactor)
        {
            for (auto x = 0; x < size; x++)
            {
                if (x % zoomFactor)
                {
                    auto base_x = (x / zoomFactor) * zoomFactor + size;
                    auto base_y = y * size;
                    auto y0 = dst[base_y + ((base_x - zoomFactor) % size)];
                    auto y1 = dst[base_y + ((base_x) % size)];
                    auto y2 = dst[base_y + ((base_x + zoomFactor) % size)];
                    auto y3 = dst[base_y + ((base_x + zoomFactor * 2) % size)];
                    auto t = static_cast<float>(x % zoomFactor) / static_cast<float>(zoomFactor);
                    dst[y * size + x] = dwCubicInterpolate(y0, y1, y2, y3, t);
                }
            }
        }
        // Then down (Y) on every column.
        for (auto x = 0; x < size; x++)
        {
            for (auto y = 0; y < size; y++)
            {
                if (y % zoomFactor)
                {
                    auto base_y = (y / zoomFactor) * zoomFactor + size;
                    auto y0 = dst[((base_y - zoomFactor) % size) * size + x];
                    auto y1 = dst[((base_y) % size) * size + x];
                    auto y2 = dst[((base_y + zoomFactor) % size) * size + x];
                    auto y3 = dst[((base_y + zoomFactor * 2) % size) * size + x];
                    auto t = static_cast<float>(y % zoomFactor) / static_cast<float>(zoomFactor);
                    dst[y * size + x] = dwCubicInterpolate(y0, y1, y2, y3, t);
                }
            }
        }
    }

    return textureData;
}

auto MilkdropNoise::generate3D(int size, int zoomFactor) -> std::vector<uint32_t>
{
    uint32_t randomSeed = static_cast<uint32_t>(std::chrono::system_clock::now().time_since_epoch().count());
    std::default_random_engine randomGenerator(randomSeed);
    std::uniform_int_distribution<int> randomDistribution(0, INT32_MAX);

    std::vector<uint32_t> textureData;
    textureData.resize(size * size * size);

    int RANGE = (zoomFactor > 1) ? 216 : 256;
    // Fill + per-row random swaps on each Z slice.
    for (auto z = 0; z < size; z++)
    {
        auto dst = (textureData.data()) + z * size * size;
        for (auto y = 0; y < size; y++)
        {
            for (auto x = 0; x < size; x++)
            {
                dst[x] = ((static_cast<uint32_t>(randomDistribution(randomGenerator) % RANGE) + RANGE / 2) << 24) |
                         ((static_cast<uint32_t>(randomDistribution(randomGenerator) % RANGE) + RANGE / 2) << 16) |
                         ((static_cast<uint32_t>(randomDistribution(randomGenerator) % RANGE) + RANGE / 2) << 8) |
                         ((static_cast<uint32_t>(randomDistribution(randomGenerator) % RANGE) + RANGE / 2));
            }
            for (auto x = 0; x < size; x++)
            {
                auto x1 = randomDistribution(randomGenerator) % size;
                auto x2 = randomDistribution(randomGenerator) % size;
                auto temp = dst[x2];
                dst[x2] = dst[x1];
                dst[x1] = temp;
            }
            dst += size;
        }
    }

    if (zoomFactor > 1)
    {
        // X, then Y, then Z cubic interpolation passes (see projectM source for full loops).
        auto dst = textureData.data();
        for (auto z = 0; z < size; z += zoomFactor)
        {
            for (auto y = 0; y < size; y += zoomFactor)
            {
                for (auto x = 0; x < size; x++)
                {
                    if (x % zoomFactor)
                    {
                        auto base_x = (x / zoomFactor) * zoomFactor + size;
                        auto base_y = z * size + y * size;
                        auto y0 = dst[base_y + ((base_x - zoomFactor) % size)];
                        auto y1 = dst[base_y + ((base_x) % size)];
                        auto y2 = dst[base_y + ((base_x + zoomFactor) % size)];
                        auto y3 = dst[base_y + ((base_x + zoomFactor * 2) % size)];
                        auto t = static_cast<float>(x % zoomFactor) / static_cast<float>(zoomFactor);
                        dst[z * size + y * size + x] = dwCubicInterpolate(y0, y1, y2, y3, t);
                    }
                }
            }
        }
        for (auto z = 0; z < size; z += zoomFactor)
        {
            for (auto x = 0; x < size; x++)
            {
                for (auto y = 0; y < size; y++)
                {
                    if (y % zoomFactor)
                    {
                        auto base_y = (y / zoomFactor) * zoomFactor + size;
                        auto base_z = z * size;
                        auto y0 = dst[((base_y - zoomFactor) % size) * size + base_z + x];
                        auto y1 = dst[((base_y) % size) * size + base_z + x];
                        auto y2 = dst[((base_y + zoomFactor) % size) * size + base_z + x];
                        auto y3 = dst[((base_y + zoomFactor * 2) % size) * size + base_z + x];
                        auto t = static_cast<float>(y % zoomFactor) / static_cast<float>(zoomFactor);
                        dst[y * size + base_z + x] = dwCubicInterpolate(y0, y1, y2, y3, t);
                    }
                }
            }
        }
        for (auto x = 0; x < size; x++)
        {
            for (auto y = 0; y < size; y++)
            {
                for (auto z = 0; z < size; z++)
                {
                    if (z % zoomFactor)
                    {
                        auto base_y = y * size;
                        auto base_z = (z / zoomFactor) * zoomFactor + size;
                        auto y0 = dst[((base_z - zoomFactor) % size) * size + base_y + x];
                        auto y1 = dst[((base_z) % size) * size + base_y + x];
                        auto y2 = dst[((base_z + zoomFactor) % size) * size + base_y + x];
                        auto y3 = dst[((base_z + zoomFactor * 2) % size) * size + base_y + x];
                        auto t = static_cast<float>(z % zoomFactor) / static_cast<float>(zoomFactor);
                        dst[z * size + base_y + x] = dwCubicInterpolate(y0, y1, y2, y3, t);
                    }
                }
            }
        }
    }

    return textureData;
}

float MilkdropNoise::fCubicInterpolate(float y0, float y1, float y2, float y3, float t)
{
    auto t2 = t * t;
    auto a0 = y3 - y2 - y0 + y1;
    auto a1 = y0 - y1 - a0;
    auto a2 = y2 - y0;
    auto a3 = y1;
    return (a0 * t * t2 + a1 * t2 + a2 * t + a3);
}

uint32_t MilkdropNoise::dwCubicInterpolate(uint32_t y0, uint32_t y1, uint32_t y2, uint32_t y3, float t)
{
    uint32_t ret = 0;
    uint32_t shift = 0;
    for (auto i = 0; i < 4; i++)
    {
        auto f = fCubicInterpolate(
            static_cast<float>((y0 >> shift) & 0xFF) / 255.0f,
            static_cast<float>((y1 >> shift) & 0xFF) / 255.0f,
            static_cast<float>((y2 >> shift) & 0xFF) / 255.0f,
            static_cast<float>((y3 >> shift) & 0xFF) / 255.0f,
            t);
        if (f < 0) f = 0;
        if (f > 1) f = 1;
        ret |= ((uint32_t) (f * 255)) << shift;
        shift += 8;
    }
    return ret;
}

} // namespace Renderer
} // namespace libprojectM
