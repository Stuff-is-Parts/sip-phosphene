// Retained from github.com/projectM-visualizer/projectm
// src/libprojectM/MilkdropPreset/Shaders/Blur2FragmentShaderGlsl330.frag
// Retrieved 2026-07-15 for PHOSPHENE compatibility evidence.
// SHORT VERTICAL 4-tap blur pass; edge darken only fires on the first V pass.
precision mediump float;

in vec2 fragment_texture;

uniform sampler2D texture_sampler;
uniform vec4 _c0; // source texsize (.xy), and inverse (.zw)
uniform vec4 _c5; // w1,w2,d1,d2
uniform vec4 _c6; // w_div, edge_darken_c1, edge_darken_c2, edge_darken_c3

out vec4 color;

void main(){
    #define srctexsize _c0
    #define w1 _c5.x
    #define w2 _c5.y
    #define d1 _c5.z
    #define d2 _c5.w
    #define edge_darken_c1 _c6.y
    #define edge_darken_c2 _c6.z
    #define edge_darken_c3 _c6.w
    #define w_div   _c6.x

    vec2 uv2 = fragment_texture.xy + srctexsize.zw*vec2(0,0);

    vec3 blur =
    (texture(texture_sampler, uv2 + vec2(0, d1 * srctexsize.w)).xyz +
    texture(texture_sampler, uv2 + vec2(0, -d1 * srctexsize.w)).xyz) * w1 +
    (texture(texture_sampler, uv2 + vec2(0, d2 * srctexsize.w)).xyz +
    texture(texture_sampler, uv2 + vec2(0, -d2 * srctexsize.w)).xyz) * w2;
    blur.xyz *= w_div;

    // Tone down at edges — only on the first X pass!
    float t = min(min(fragment_texture.x, fragment_texture.y),
                  1.0 - max(fragment_texture.x, fragment_texture.y));
    t = sqrt(t);
    t = edge_darken_c1 + edge_darken_c2 * clamp(t * edge_darken_c3, 0.0, 1.0);
    blur.xyz *= t;

    color.xyz = blur;
    color.w = 1.0;
}
