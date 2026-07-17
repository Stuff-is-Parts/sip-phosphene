# PHOSPHENE — working rules for any agent (including Claude) in this repo

Read PHOSPHENE-GOAL.md and Witnessed-Failure-Modes-PHOSPHENE.txt before working. This file
is the operating constraint. It is short on purpose. Do not extend it into a
framework.

## The mechanical gate (off-the-shelf, language-level only)
Before any code is a candidate for review, it must pass:

    npm run gate     # = syntax -> typecheck -> lint -> deadcode

- `syntax`    node --check (does it parse)
- `typecheck` tsc --strict (types connect; unused locals; unchecked index access)
- `lint`      eslint + typescript-eslint (no-unused-vars = error)
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

If you find yourself proposing a check to "make sure the gate is meaningful,"
or explaining why a semantic layer is actually mechanical, STOP. That is the
inflation that produced the scrapped verification-framework (see
Witnessed-Failure-Modes-PHOSPHENE.txt #13, #14, #15). The gate is four standard tools. It is
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

## Behavior is judged by the human, not the machine
The user is the frame diff for VISUAL correctness. Do not build a producer-
controlled universal behavioral-certification system, a frame-diff, or a visual
comparator that stands in for the user's eyes. That is the banned thing.
This does NOT forbid checking a value against an EXTERNAL reference where one
exists (source geometry, or a reference implementation's output) — that is
encouraged (see PHOSPHENE-GOAL.md). The line: external reference = allowed;
self-referential or producer-controlled certification = banned. Produce code
that passes the mechanical gate; the user decides if it looks right.
