# Plane9 Node Semantics Ledger — scene-2 candidate types

Evidence-backed port contracts for the five node types Color Cycle uses
(sources/plane9/color-cycle.scene.xml). Authority: the engine's embedded
node-metadata table — node names, descriptions, and per-port help strings —
extracted verbatim from `Plane9Engine.dll` (2016-12-26 build) and retained at
`design/plane9-engine-node-strings.txt` with byte-range provenance. Corpus
statistics derive from all 252 scenes in source-scenes/plane9. Anything not
witnessed is Unresolved. Compiled 2026-07-18.

## Screen

DLL description of ports (verbatim): Viewport "A part of the screen that we
should render everything to"; CamPos "Camera position"; CamLookAt "What point
the camera should lookat"; CamLookAtInWorldSpace "The camera look at
poistion is in worldspace. If false is relative to camera position"; CamFov
"Camera FOV"; CamNear "Camera near plane"; CamFar "Camera far plane";
ScaleByAspect "Adjust the size of any rendered objects depending on the
aspect of the screen." (plus VR-only ports ObjectInCenterVR, UseVRSpecific,
FloorCenterVR — absent from Color Cycle's XML).

Color Cycle values: Viewport "0 0 1 1", CamPos "0 0 -2", CamRot "0 0 0",
CamLookAt "0 0 1", CamLookAtInWorldSpace false, CamFov 45, CamNear 0.1,
CamFar 1000, ScaleByAspect false. Note: CamRot appears in scene XML but not
in the dll help cluster — its description location is Unresolved.

In-port witnessed in connections: `Screen.Render` (the render chain's sink),
`Screen1.CamPos` accepts a Vector output (Face Of Sound).

## Clear

DLL description (verbatim): "Fills the viewport with a single color." One
value port witnessed: Color (RGBA, Color Cycle: "0.03857 0.11049 0.216148 1").
Ports witnessed in connections: out `Clear1.Render`, in `Clear1.Color`
(driven by HSLAToColor1.Color in Color Cycle).

## HSLAToColor

DLL description (verbatim): "Converts a Hue, Saturation, Lightness and alpha
component to a color". Ports: Hue "The 'real' color. In degrees";
Saturation "The saturation of the color."; Lightness "The lightness of the
color"; Alpha "The alpha color component". Out port witnessed in
connections: Color. The exact HSL-to-RGB formula is Unresolved (candidate
oracle: drive known inputs, screenshot Plane9, eyedrop — tier 5).

## MinMax

DLL description (verbatim): "Interpolates a float value using delay times.
Doesn't handle \"local\" evaluators". Ports: Min "Minimum allowed value";
Max "Maximum allowed value"; Mode; DelayMin "Delay minimum allowed value";
DelayMax "Delay maximum allowed value"; DelayMode "Delay Mode"; ITimeMin
"Interpolation time minimum allowed value"; ITimeMax "Interpolation time
maximum allowed value"; ITimeMode "Interpolation Mode". Out port witnessed
in connections: Value.

Mode enumerator NAMES witnessed adjacent in the dll table: Rand,
RandShortestDist, LoopUp, LoopDown. Numeric mapping is Unresolved.
Corpus usage across 118 instances: Mode {1:101, 2:11, 3:1, 4:5},
DelayMode {1:113, 0:5}, ITimeMode {1:118} — so values 0-4 occur in the
wild and the mapping question is live for Color Cycle (its three MinMax
nodes use Mode 2, 1, 1).

Reading of Color Cycle's intent pending mapping: MinMax1 (0..360, Mode 2,
ITime 60-90s) drives Hue; MinMax2 (0..1, Mode 1, ITime 3-20s) drives
Beat.NoMusic; MinMax3 (0..0.5, Mode 1, ITime 3-20s) drives Lightness. The
interpolation curve, delay behavior, and per-mode target selection are
Unresolved (tier 5: observe a single MinMax in Plane9.Studio).

## Beat

DLL description (verbatim): "Detects the beat in the currently playing
music and output its as a value going from 0.0 to 1.0". Ports: NoMusic
"Value to use if no music is playing"; Amplification "How much to amplify
the values"; Min "Minimum value"; Max "Maximum value". Out port:
BeatStrength "The strength of the current beat".

Color Cycle values: NoMusic 0.448237 (overridden live by MinMax2.Value via
connection), Amplification 4, Min 0.3, Max 1. The detection algorithm and
how Min/Max/Amplification compose are Unresolved — the audio path runs
through bass.dll into the engine; candidate evidence: tier-5 controlled
observation, and comparison oracles once our own beat value exists.

## Cross-cutting facts witnessed this pass

- The engine embeds the complete node reference (name + description + port
  help for all 75 types) — the missing "node reference" from the public
  docs site lives inside `Plane9Engine.dll`, retained in full.
- Loader strings witness the XML contract: "Unknown node type \"%s\"!",
  "Failed to create connection from ... to ...", "Unable to created a
  connection between nodes of different type %ld -> %ld" — connections are
  TYPE-CHECKED port-to-port edges; port type taxonomy is Unresolved.
- `.p9s` appears alongside `.p9c` in Studio strings — an uncompiled scene
  format (the editor's working format); no .p9s files exist in the corpus.
- Expression builtin list witnessed (for later Expression-node work):
  "abs, mod, min, max, sqrt, sin, cos, tan, atan, log, lb, exp, ceil,
  floor, deg, rad, if, select, equal, above, below, clip, clamp, and, or,
  not" with outputs out1-out3. The expression vocabulary's corpus usage and
  partial semantics live in `sources/PLANE9-CONTRACT.md`; the node-to-
  primitive mapping for all 75 types lives in `sources/PRIMITIVES-PLANE9.md`
  — the converter design consumes both alongside this ledger.

## Unresolved queue for scene 2 (each names its next evidence source)

1. MinMax mode numeric mapping + interpolation curve → Plane9.Studio
   dropdown order (tier 3) + controlled observation (tier 5).
2. Beat detection algorithm and Min/Max/Amplification composition →
   controlled observation with known audio (tier 5).
3. HSLAToColor exact color math → drive known values, eyedrop the oracle.
4. Graph evaluation order (when value nodes tick relative to Render chain)
   → observation + loader strings.
5. Screen camera model relevance for a full-viewport Clear (Color Cycle
   renders no geometry — the camera may be inert for scene 2, which would
   shrink the conversion surface; verify by observation).
