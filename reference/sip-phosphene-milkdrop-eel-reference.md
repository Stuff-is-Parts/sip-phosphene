# MilkDrop EEL Function Semantics {#top}

---

### DOCUMENT ROLE

Layer 4 reference opened for MilkDrop expression parsing, built-ins, numerical
semantics, or EEL review. Responsibility: owns the cited function and operator
semantics used by PHOSPHENE's MilkDrop expression path; variable exposure and
lifecycle remain in the variable reference.

---

### 1. EEL SEMANTICS {#eel-semantics}

#### I. WHAT

PHOSPHENE transcribes the accepted MilkDrop EEL function and operator surface
from pinned implementations, including their comparison epsilons, guards, and
deterministic random stream.

#### II. HOW

Source opened this audit (per SOURCE-LOCATIONS.md; no retained copies):
- **[PM-EVAL]** projectm-eval @ da885dcdf33620ef26aa04cac9e215378b80252e
  (master, fetched 2026-07-17): projectm-eval/TreeFunctions.c (implementations),
  projectm-eval/api/projectm-eval.h (types: PRJM_F_SIZE defaults 8 → double,
  :14-22; PRJM_EVAL_I = int64_t in double build, TreeFunctions.c:14-16).
  Tier 2. Tier 1 is MilkDrop's embedded ns-eel2 (registry row: WDL/vis_milk2 —
  not yet consulted; consult on suspected divergence).

Two epsilon constants govern comparisons (TreeFunctions.c:116-125):
- `COMPARE_CLOSEFACTOR = 0.00001` (close_factor) — sigmoid, band, bor.
- `close_factor_low = 1e-300` (double build) — equal, noteq, bnot, div, pow.
  The source notes ns-eel2's own value is the denormal 0x00000000FFFFFFFF;
  1e-300 is projectm-eval's stand-in, "shouldn't matter too much" (their words,
  :120-122).

## Per-function table (all 36 in src/eel.mjs)

| Function | Source semantics | Citation (TreeFunctions.c) |
|---|---|---|
| sin cos tan atan atan2 sqrt exp floor ceil abs | plain libm delegate | :872-906, :944-981, :1006-1016, :1054-1076, :1106-1116 |
| asin, acos | input outside [-1,1] → 0, else libm | :908-942 |
| pow | \|base\| < close_factor_low AND exp < 0 → 0; NaN result → 0; else libm pow | :983-1004 |
| log, log10 | input ≤ 0 → 0, else libm | :1018-1052 |
| min, max | ternary compare | :1118-1146 |
| sqr | x·x | :1094-1104 |
| sign | 0 → 0; <0 → −1; else 1 | :1148-1163 |
| invsqrt | fast inverse sqrt, one Newton step; NaN → 0. Float build: magic 0x5f3759df (uint32); double build: 0x5fe6eb50c7b537a9 (uint64). Source comment: the float path is "same as Milkdrop" | :1183-1220 |
| sigmoid | t = 1+exp(−x·k); \|t\| > 1e-5 ? 1/t : 0 | :1078-1092 |
| add sub mul | plain IEEE-754 ops | :531-575 |
| div | \|divisor\| < close_factor_low → 0, else divide | :576-595 |
| mod | int64 truncating mod; divisor 0 → 0 | :597-616, :14-16 |
| band, bor | \|arg\| > 1e-5 tested per arg (the LARGER epsilon — source's own comment flags this) | :672-702 |
| bnot | \|x\| < close_factor_low → 1 else 0 | :430-440 |
| equal, noteq | \|a−b\| < close_factor_low → equal; noteq is strictly > | :442-469 |
| below above beleq aboeq | plain compares | :471-530 |
| rand | MT19937 with FIXED seed 0x4141f00d ("Milkdrop's original rand()"); rand(x) = draw/0xFFFFFFFF * max(1, floor(x)) — a float, deterministic stream | :150-224, :1165-1181 |

## Divergences this audit found and fixed in src/eel.mjs

| Function | Was (unevidenced) | Now (source-derived) |
|---|---|---|
| equal/noteq | 1e-5 epsilon | 1e-300 (close_factor_low) |
| band/bor | !== 0 truthiness | \|arg\| > 1e-5 per arg |
| bnot | !== 0 | \|x\| < 1e-300 |
| asin/acos | NaN outside domain | 0 outside domain |
| pow | Infinity on 0^neg, NaN passthrough | 0 guards per source |
| log/log10 | −Infinity/NaN on ≤0 | 0 per source |
| div | Infinity on /0 | 0 on near-zero divisor |
| mod | 32-bit \|0 truncation | 64-bit-faithful Math.trunc (exact to 2^53) |
| invsqrt | no NaN guard | NaN → 0 per source |

## Open divergence between authorities (documented, not resolved)

invsqrt: eel.mjs keeps the FLOAT32 magic path because the tier-2 source's own
comment attributes exactly that to MilkDrop; projectm-eval's double build uses
the 64-bit magic instead. Resolution path: open MilkDrop's embedded ns-eel2
(tier 1, registry) and confirm which the original engine executes. Until then
the float path stands as the better-attributed choice, and this row is the
trail.

## Check coverage

check.mjs carries per-function cases: expected values fixed from the cited
formulas/constants above (computed independently of eel.mjs — see the
provenance comments in the check), including the discriminating cases that
separate source semantics from the pre-audit behavior (equal at 1e-8, band at
1e-6, pow(0,−2), log(−1), asin(2), mod at 2^32, div by 0).

#### III. WHY

Small numerical differences in an expression VM compound across frames; an
explicit cited table prevents JavaScript defaults or secondary implementations
from silently becoming MilkDrop semantics.

[Back to Top](#top)
