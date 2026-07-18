# PHOSPHENE — working rules for any agent (including Claude) in this repo

Read PHOSPHENE-GOAL.md and Witnessed-Failure-Modes-PHOSPHENE.txt before working. This file
is the operating constraint. It is short on purpose. Do not extend it into a
framework.

## The mechanical gate (off-the-shelf, language-level only)
Before any code is a candidate for review, it must pass:

    npm run gate     # = syntax -> typecheck -> lint -> style -> deadcode

- `syntax`    node --check (does it parse)
- `typecheck` tsc --strict (types connect; unused locals; unchecked index access)
- `lint`      eslint + typescript-eslint (no-unused-vars = error)
- `style`     stylelint (page CSS; bans custom rules targeting shadow-DOM
              component selectors, enforcing the APIs-over-custom rule below)
- `deadcode`  knip (no orphan exports/files)

These are standard tools. They prove the code is well-formed AS CODE. They do
NOT prove it is correct. Correctness of behavior is judged by a human viewing
the output. That division is deliberate.

## The gate does not grow — this is a hard rule
Do NOT add checks to the gate. Not unit tests, not behavioral assertions, not
coverage thresholds, not a "check that verifies the checks," not anything whose
pass/fail depends on knowing what the code is SUPPOSED to do. Any check that
needs project-specific knowledge of intended behavior is banned by category,
not evaluated on merit.

Owner amendment 2026-07-18: the gate admitted stylelint as a fifth tool. The
amendment path is narrow — a standard, off-the-shelf, language-level tool the
owner ratifies by name. The ban on behavior-knowing checks stands unchanged.

If you find yourself proposing a check to "make sure the gate is meaningful,"
or explaining why a semantic layer is actually mechanical, STOP. That is the
inflation that produced the scrapped verification-framework (see
Witnessed-Failure-Modes-PHOSPHENE.txt #13, #14, #15). The gate is five standard tools. It is
complete. It needs nothing on top of it.

## The element-port method (for source translation)
When porting a behavior from MilkDrop/Plane9 source: TRANSCRIBE the cited source
lines into the new code — do not write from your idea of what the element does.
Paste the source lines (with file:line) in the commit or comment before porting.
The check for a port is: the transcription matches the source (a reader can diff
the two), and the user loads the scene and sees it render correctly. Never widen
a tolerance or wrap a failing case to reach green; if something is wrong, say WHY
in words before editing. (The four-file element-port harness — reference/subject/
mutant/check — lives outside this repo as a development tool; it is not required
to be present here.)

## Both engines before shared machinery; convert, never emulate
Shared machinery (timing, audio, rendering, expression semantics — anything
more than one scene flows through) is derived only after BOTH engines'
evidence is on the table; deriving from one engine and applying it to all
scenes is drift. Per PHOSPHENE-GOAL.md (one native execution model, no
parallel runtimes, behavior represented explicitly in the graph): the native
substrate is platform APIs (raw frame time, raw audio samples, WebGPU), and
each source engine's solution CONVERTS into explicit, citable components
expressed in that substrate — a converted scene carries or references the
components its behavior depends on. Ambient engine-level switches keyed to a
scene's source engine are parallel runtimes and are banned. Per behavior,
assess borrow-vs-modern with both engines' contracts in view: the scene-visible
contract is non-negotiable; the mechanism beneath it is free to be modern.

## APIs over custom code (owner-ratified 2026-07-18)
When the design needs capability the admitted APIs do not provide, the answer
is admitting a new standard API — pinned, vendored, license and provenance
beside it — never custom code imitating one. Custom code layered on top of an
admitted API's own surface is the failure this rule targets (witnessed: a
hand-rolled one-way fold where CodeMirror ships toggleable folding). Each
custom rule or behavior that survives carries a one-line comment naming why
the API had no answer. Boundaries: a library's documented styling surface IS
its API (CodeMirror's theme classes), so styling through it complies; a
shadow-DOM component library's internals are not, and the stylelint gate step
bans stylesheet selectors that reach for them. The JS half of the rule is not
mechanically checkable — the standing question "does the library already do
this?" is the instrument there.

## Fix over document — the falsifier test
A gap may be DOCUMENTED (as a known limit, interim state, or unresolved row)
ONLY when nothing in the current slice can falsify its closure — no content,
no editor surface, no check that could catch the fix being wrong. If any
in-slice surface can catch it, the gap is due work in the current window, not
a documentation entry. Documenting-instead-of-fixing when the fix costs
comparable effort is a named failure mode: the documentation performs
diligence while withholding the work. Before writing any "known limit,"
apply the test and name the missing falsifier in the entry itself — an entry
that cannot name one is a fix you are avoiding.

## Behavior is judged by the human, not the machine
The user is the frame diff for VISUAL correctness. Do not build a producer-
controlled universal behavioral-certification system, a frame-diff, or a visual
comparator that stands in for the user's eyes. That is the banned thing.
This does NOT forbid checking a value against an EXTERNAL reference where one
exists (source geometry, or a reference implementation's output) — that is
encouraged (see PHOSPHENE-GOAL.md). The line: external reference = allowed;
self-referential or producer-controlled certification = banned. Produce code
that passes the mechanical gate; the user decides if it looks right.
