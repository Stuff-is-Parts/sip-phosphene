# Plane9 execution model (from installed-app evidence)

Derivation evidence for COMPATIBILITY-GOAL.md Plan step 2. Sources, all
witnessed on this machine from Plane9 2.5.1.3 at
`C:/Program Files (x86)/Plane9` (referenced below as `$P9`; extraction
scripts in `scripts/` re-produce every artifact from any install):

- `$P9/nodedata/shader.glsl` — the injected helper library (706 lines,
  96 definitions), read in full. Local copy: `fixtures/plane9/shader.glsl`
  (gitignored; Plane9's file, not ours to redistribute).
- `$P9/nodedata/{bloom,blur,streak,downscale2,ls_jacobi,scenefxaa,
  scenepreaa}.glsl` — post-process node shader implementations.
- `Plane9Engine.dll` embedded strings (`scripts/extract-p9-dll-strings.mjs`)
  — the engine shader templates and uniform contract.
- `docs/plane9-node-census.json` (`scripts/census-p9-nodes.mjs`) — full
  structural census of the 252-scene corpus.
- Blog post 103 (`plane9.com/blog/posts/103`) and the wiki
  (`plane9.com/wiki/nodes`, `/wiki/shaderfunctions`) — cross-checks.

## 1. Scene container

`.p9c` = zip holding `scene.xml`. Root element `Plane9Scene` with
attributes `@FormatVersion, @Id, @ParentId, @WarmupTime, @SceneType,
@Version, @DevelopmentTime, @Created, @LastModified` and children
`Author, Desc, Tags, License, Nodes, Connections, SceneCompatibility`
(census: topLevelXmlKeys, 252/252 scenes parsed, 0 errors).

- `@WarmupTime`: seconds the engine pre-runs a scene before display —
  the importer must honor it or trail/feedback scenes start cold.
- `Nodes/Node[@Type,@Id,...]` each with `Port[@Id]` children carrying
  `Value` (numbers, numeric vectors as strings, or CDATA shader text).
- `Connections/Connection[@Out="NodeId.Port", @In="NodeId.Port"]` —
  the single link encoding (3,271 instances corpus-wide, census).

## 2. Node inventory

75 node types in the shipped corpus (full port-level detail in
`docs/plane9-node-census.json`). By scene reach: Screen 252, Clear 252,
Shader 247, RenderRect 214, RenderObject 161, RenderToTexture 138,
Bloom 103, Expression 93, MeshObject 86, Vector 80, PreviousLayer 76,
CloneExpression 59, FileTexture 42, Transition 40, Cube 35, Plane 29,
MinMax 25, HSLAToColor 25, StoreTexture 22, Particles 21 (38 ports),
Blur 18, TransformMesh 18, Beat 17, CopyTexture 17, Sphere 17, and 50
more. The census records every port id, value kind, and 3 sample values
per port — that file is the requirements spec for the importer's
node-type coverage.

## 3. Rendering model

- The graph renders left-to-right (wiki tutorial1); `Screen` is the
  sink. `Clear` clears a target; `RenderRect` draws a fullscreen
  (tessellatable) quad with an attached Shader effect; `RenderObject`
  draws a mesh (`MeshObject` + primitive mesh nodes Cube/Sphere/Plane/
  Torus/Cone/Cylinder/Disc, composable via TransformMesh/CloneMesh).
- Render-to-texture graphs: `RenderToTexture` (own target, 16 ports incl.
  size/format), `PreviousLayer` (previous rendered layer as texture),
  `StoreTexture`/`CopyTexture`, `Blur`, `Bloom` (22 ports), `Transition`
  (40 scenes — blends two sub-render chains during scene changes).
- CPU dataflow: `Expression` (7 ports; user math with animated inputs),
  `Vector`, `MinMax`, `Beat`/`Spectrum`/`Waveform` (audio), color nodes
  (`HSLAToColor` etc.), feeding Shader-node `In1..In3`, `Color1/Color2`,
  and transform/camera ports per connection.

## 4. Shader-node contract (engine template, DLL strings)

VERTEXOUTPUT struct (7 fields): diffuse (vec4), tex (vec2), wnormal,
viewdir, worldpos, pos, viewpos (vec3). Default vertex main (verbatim,
DLL block 15):

```glsl
so.pos      = iPosition.xyz;
so.worldpos = (gM * iPosition).xyz;
so.viewpos  = (gMV * iPosition).xyz;
gl_Position = gMVP * iPosition;
so.tex      = iTexCoord;
so.diffuse  = iColor*gColor;
so.wnormal  = normalize(mat3(gM) * iNormal);
so.viewdir  = gViewPosition - so.worldpos;
// Hemisphere light
float a = dot(so.wnormal, vec3(0.0, 1.0, 0.0))*0.5+0.5;
so.diffuse *= mix(vec4(0.957, 0.655, 0.055, 1.0), vec4(0.165, 0.675, 0.988, 1.0), a);
```

NOTE: this is the STUDIO's default template for new Shader nodes; each
shipped scene carries its own vertex main in its shader text. `si.viewdir`
is NOT normalized by the engine template (scenes normalize it themselves).

Uniform contract (verbatim, DLL block 14): matrices `gM,gMVP,gMIT,gVI,gV,
gP,gMV,gVP,gMT,gVT,gPT,gMVPT,gMVT,gVPT` (T = transpose); `gTime`;
`gIn1/gIn2/gIn3` (vec3, node-graph driven); `gColor1,gColor2` (Shader-node
color ports) plus `gColor` (effect tint, seen in templates); `gTexture1..4`
with `gTexture1Size..4Size` and `gTargetSize`; `gZNear,gZFar`. Vertex
inputs: `iPosition,iColor,iTexCoord,iNormal,iTangent,iBinormal,
gl_VertexID,gl_InstanceID`. Fragment extra: `gl_PointCoord`. Stage
transfer via `so`/`si`. Texture ports generate BOTH linear and point
samplers (`uniform sampler%1D %2;` / `%2Point` templates).

## 5. Helper library (`nodedata/shader.glsl`, read in full)

Structure: common section (samplers `gPermutation1dSampler`,
`gPermutation2dSampler`, `gFastPerlinNoiseSampler`; PI/PI2; saturate
overloads) — `//** ENDCOMMON **` — main library —
`//** FRAMENTSHADERONLY **` + `#ifdef FRAGMENT` section (dFdx-dependent
helpers). The engine injects only functions a scene references
(blog 104). Key authoritative facts that differ from common textbook
forms (line refs into fixtures/plane9/shader.glsl):

- `_luminance`: Rec.709 coefficients (L11).
- `_tolinear`: cubic polynomial approximation, NOT pow(2.2) (L14).
- `_hsv2rgb`: branchless triangle-wave form (L26).
- `_rand` family: exact fract/dot constants (L28-36).
- `_perm`: permutation TEXTURE lookups — engine-generated textures whose
  content is not in any file; reproduction requires observation or a
  standard Perlin permutation assumption, which must be validated against
  reference renders (L56-57).
- `_noisefast`: samples a 3D `gFastPerlinNoiseSampler` texture with a
  two-frequency rotation trick (L58-65) — engine-generated content.
- `_noise/_noisederiv`: Brian Sharpe's textureless simplex (portable as
  pure math) (L124-266).
- `_fbm/_turbulence/_ridgedmf` (+fast variants): lacunarity 2.13628142,
  gain 0.5, amp-sum normalized (L78-315).
- `_voronoi`: 2D and 3D, jitter param, 3 distance metrics, f1/f2 +
  positions via _perm textures (L316-402).
- Lighting: `_lightBlinnPhong` is float-returning 4-arg with energy
  factor `(hardness+4)/8` (L613); `_shade`/`_lightDirectional` is GGX
  Cook-Torrance with Schlick fresnel and height-correlated-ish
  visibility (L627-654); `_lightPoint` attenuation
  `pow(saturate(1-(d/r)^4),2)/(d²+1)` (L655-662); `_specularIBL` is
  importance-sampled panoramic IBL with Karis env-BRDF approx (L663-705).
- `_perturbNormal`: two dFdx/dFdy screen-space forms (L578-596);
  `_perturbNormalTexture`: derivative tangent frame (L569-577).
- Tone maps: Filmic (Hejl), Uncharted2 (Hable + white 11.2), ACES
  (Narkowicz) (L440-462).
- `_blackBody`: log-fit in 0-255 space, smoothstep(900,1000) low cutoff,
  pow-2.2 linearize (L489-508).
- `_liftGammaGain`: `pow(gain*(col + lift*(1-col)), gamma)` — raw gamma
  exponent (L481-484).
- `_screenSpaceDither(vec2)`: per-channel constants (171,231)/(103,71,97),
  centered -0.5, /255 (L463-468); no-arg fragment variant uses IGN
  (L555-559). `_interleavedGradientNoise` separate (L469-473).
- `_brightnessSaturationContrast`: brightness multiply → Rec.709 luma
  saturation mix → `mix(vec3(0.5), c, contrast)` (L474-480).
- `_bump`: smoothstep DIFFERENCE `s(start-w,start,v) - s(end,end+w,v)`
  (L407-410).
- `_stepaa`: fwidth-based AA step via dFdx/dFdy (L560-564).
- `_textureBicubic`, `_texturePanoramic(Lod)` (equirect:
  `(1+atan(x,-z)/PI)*0.5, 1-acos(y)/PI`) (L509-545).
- `_fog`: exponential (L546-550).

`SampleWithBorder` is NOT in the library: the six transition scenes that
call it define it inline (`vec4 SampleWithBorder(vec4 border, sampler2D
tex, vec2 uv)` — border color returned outside [0,1], witnessed in
Transition/Swirl Transition.p9c).

## 6. Post-process node shaders

`$P9/nodedata/`: `bloom.glsl` (163 lines), `blur.glsl` (105),
`downscale2.glsl`, `streak.glsl`, `ls_jacobi.glsl` (fluid solver),
`scenefxaa.glsl`, `scenepreaa.glsl` — the implementations behind the
Bloom/Blur/Streak/Fluid2d node types. Local copies in `fixtures/plane9/`;
read these when implementing each node type.

## 7. Known-unavailable without runtime observation

Explicit unsupported-until-evidenced items (COMPATIBILITY-GOAL.md
Hard Rules — no invented fallbacks):

1. Permutation-texture and FastPerlinNoise-texture CONTENTS
   (engine-generated at startup; affects `_perm`, `_noisefast`,
   `_voronoi` exactness). Path: reference-render comparison, or GL
   capture of the running app.
2. Per-node runtime semantics beyond port structure for CPU nodes
   (Beat's exact envelope, SignalGenerator waveform details). Wiki gives
   descriptions; exact behavior needs observation against the running
   app. The Expression node's evaluator is IDENTIFIED: `$P9/plane9.txt`
   credits "Expression Evaluator by Brian Allen Vanderburg II
   (expreval.sourceforge.net)" — the function set and syntax are that
   open-source library's documented behavior.
3. Camera/projection defaults (gViewPosition default, FOV, near/far
   values per scene) — extractable from scene Transform/Camera node port
   values per scene; engine defaults need observation.
4. `gColor` (effect tint) default value and animation source.
