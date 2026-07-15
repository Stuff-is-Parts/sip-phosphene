# Evidence — authoritative source for compatibility work

This directory holds extracted source excerpts and observed runtime
evidence used to derive MilkDrop and Plane9 semantics under
[COMPATIBILITY-GOAL.md](../../COMPATIBILITY-GOAL.md).

Contents:

- `butterchurn/` — hand-picked source files from butterchurn 2.6.7
  (`node_modules/butterchurn/lib/butterchurn.min.js` split for
  readability). Read for MilkDrop preset lifecycle, audio processing,
  and the default shader forms.
- `projectm/` — source excerpts from the projectM repository.
  Read for canonical MilkDrop semantics that butterchurn re-ports.

Related pinned research-only packages (in `package.json`
`devDependencies`):

| Package | Purpose |
|---|---|
| `butterchurn` | Full source available for lookup at `node_modules/butterchurn/`. Not imported by any PHOSPHENE runtime or test code. Reading only, for cross-referencing this directory's excerpts. |
| `milkdrop-preset-converter` | Full source at `node_modules/milkdrop-preset-converter/`. Not imported. Reading only, for verifying the varMap and equation-emission conventions PHOSPHENE's parser mirrors. |

Both packages were previously wired into a screenshot-comparison
oracle. That machinery was deleted in commit `43061e1`. The packages
are retained as research artifacts so future semantic tests can cite
specific lines and functions from the source without needing to
re-fetch or re-vendor them.

Neither package may be imported by any runtime code or by any test.
Direct semantic tests read this evidence directory and the packages
in `node_modules` as reference material; they never invoke either
package's rendering, conversion, or evaluation code as an oracle at
runtime.
