# Plane9 RenderToTexture Format Evidence {#top}

---

### DOCUMENT ROLE

Layer 4 evidence reference opened only for Plane9 RenderToTexture format work.
Responsibility: preserves reproducible binary evidence mapping the serialized
Format enum to OpenGL formats. It establishes one field, not the complete node
contract or compatibility.

---

### 1. FORMAT ENUM EVIDENCE {#format-evidence}

#### I. WHAT

For Plane9 v2.5.1, serialized RenderToTexture `Format=5` maps through
`GL_RGBA16F` to WebGPU `rgba16float`; five other registered values are also
identified below.

#### II. HOW

Binary evidence — treat as executable implementation evidence, not
original source code — recovered from the Plane9 installation and
recorded here so a future instance can rebuild the mapping without
re-running the disassembly.

## Analyzed binary

- File: `C:\Program Files (x86)\Plane9\Plane9Engine.dll`
- Product version: Plane9 v2.5.1
- Size: 2,501,736 bytes
- SHA-256: `4cebc1b36f003a550b4fc6ae1979d579f4f7f27b03599c7aef88fd5526ba1196`
- PE architecture: PE32 / i386
- Embedded PDB path:
  `C:\teamcityagent\work\plane9_v2.5.1\build\Plane9Engine.pdb`

## Direct binary observations

Each subsection records what was read directly from bytes at named
virtual addresses. Interpretation follows separately below.

### RTTI class names

- `.?AVCRenderToTextureNode@@` — the RenderToTexture node's registered
  runtime class.
- `.?AVCTextureOGL@@` — the OpenGL texture wrapper class.

### RenderToTexture enum-registration routine

- Class routine begin (VA): `0x100CDA70` (CRenderToTextureNode).
- Instruction sequence extracted from the routine that registers the
  Format-port enum labels against their serialized integer values:

  ```
  100CDBDE  push 0x101EFA60     ; -> string "RGBA 8bit"
  100CDBE3  push 1

  100CDBF2  push 0x101E8728     ; -> string "RGBA 32bit float"
  100CDBF7  push 4

  100CDC00  push 0x101E873C     ; -> string "RGBA 16bit float"
  100CDC05  push 5

  100CDC0E  push 0x101EFA6C     ; -> string "RG 16bit float"
  100CDC13  push 8

  100CDC1C  push 0x101EFA7C     ; -> string "R 16bit float"
  100CDC21  push 9

  100CDC2A  push 0x101EFA8C     ; -> string "RGB R11,G11,B10 bit float"
  100CDC2F  push 6
  ```

- Serialized-to-label mapping registered by CRenderToTextureNode:

  | Format XML value | Enum label                     |
  |------------------|--------------------------------|
  | 1                | RGBA 8bit                      |
  | 4                | RGBA 32bit float               |
  | 5                | RGBA 16bit float               |
  | 6                | RGB R11,G11,B10 bit float      |
  | 8                | RG 16bit float                 |
  | 9                | R 16bit float                  |

- The enum is sparse. Values 0, 2, 3, 7 are not registered by this
  routine.

### Texture-allocation switch

- Class routine begin (VA): `0x100F4BF0` (CTextureOGL constructor).
- Imported function called into: `QOpenGLTexture::setFormat(QOpenGLTexture::TextureFormat)`
  via IAT entry at VA `0x101DE9CC`.
- The internal-format switch decrements the format value, compares
  against 8, and dispatches through a jump table at `0x100F4FA8`:

  ```
  100F4D85  dec eax
  100F4D86  cmp eax, 8
  100F4D8B  jmp dword ptr [eax*4 + 0x100F4FA8]
  ```

- For input format value 5 the jump-table index is 4 and control
  transfers to `0x100F4DA7`:

  ```
  100F4DA7  push 0x881A        ; internal format constant
  100F4DAC  jmp 0x100F4DC8
  100F4DC8  mov ecx, [esi+0x38]
  100F4DCB  call dword ptr [0x101DE9CC]   ; QOpenGLTexture::setFormat
  ```

- The full case set the allocator establishes:

  | Input | Internal format constant       |
  |-------|--------------------------------|
  | 1     | 0x8058                         |
  | 4     | 0x8814                         |
  | 5     | 0x881A                         |
  | 6     | 0x8C3A                         |
  | 8     | 0x822F                         |
  | 9     | 0x822D                         |

## Interpretation

### Constant identification

The internal format constants passed into `QOpenGLTexture::setFormat`
match published OpenGL sized-internal-format enumerants:

| Constant | OpenGL name         |
|----------|---------------------|
| 0x8058   | GL_RGBA8            |
| 0x8814   | GL_RGBA32F          |
| 0x881A   | GL_RGBA16F          |
| 0x8C3A   | GL_R11F_G11F_B10F   |
| 0x822F   | GL_RG16F            |
| 0x822D   | GL_R16F             |

### RenderToTexture Format = 5 → WebGPU rgba16float

Combining the enum-registration routine with the allocator switch:

```
XML Format="5"
  → Plane9 label "RGBA 16bit float"
  → QOpenGLTexture::setFormat(0x881A)
  → OpenGL GL_RGBA16F
  → WebGPU rgba16float
```

WebGPU `rgba16float` is the direct semantic equivalent of GL_RGBA16F
(four 16-bit half-float channels, linear color space, no sRGB
conversion, no alpha compression). PHOSPHENE's native resource substrate can
allocate this format, but the Plane9 converter does not authorize the node.

## Why the earlier string-cluster inference was invalid

An earlier evidence pass on the same DLL scanned the string table for
adjacent enum-label clusters near the RenderToTexture metadata block
at `0x1f8ad4` and reported the mapping as UNRESOLVED because no such
cluster existed there. That inference was wrong. The RenderToTexture
Format enum is registered from executable code — the label pointers
sit at `0x101EFA60`, `0x101E8728`, `0x101E873C`, `0x101EFA6C`,
`0x101EFA7C`, `0x101EFA8C`, which are spread across several kilobytes
of `.rdata` and are cross-referenced by push instructions in
CRenderToTextureNode's registration routine. String scanning cannot
observe those cross-references; only following the code path from
the RTTI-identified class into the setFormat call establishes the
mapping.

Rule for future evidence recovery: a failed string search means
"this search method did not recover the information", never "the
information is not in the installation". Before declaring
implementation data unavailable, follow the code path — RTTI class
names, constructor and registration routines, enum registration
calls, sparse enum values, switch statements and jump tables,
imported API calls, and constants passed to graphics APIs are all
authoritative implementation evidence.

## Current PHOSPHENE conversion support

At the current checkout, `P9_COMPATIBILITY.RenderToTexture.status` is
`UNRESOLVED` and `nativeOp` is
`null`; every Plane9 RenderToTexture node refuses conversion. The native
resource schema and executor support `rgba16float` and fixed pixel dimensions,
but those substrate capabilities do not authorize this source node. Its Effect
input, nested Shader and Expression payloads, execution path, Color output,
and render-target state/lifecycle remain unresolved.

#### III. WHY

The enum mapping is durable binary evidence worth retaining, but labeling its
narrow scope prevents evidence for one pixel-format field from inflating into
a complete RenderToTexture implementation claim.

[Back to Top](#top)
