# PHOSPHENE — working rules for any agent (including Claude) in this repo

Read PHOSPHENE-GOAL.md and Witnessed-Failure-Modes before working. This file
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
Witnessed-Failure-Modes #13, #14, #15). The gate is four standard tools. It is
complete. It needs nothing on top of it.

## The element-port method (for source translation)
When porting a behavior from MilkDrop/Plane9 source, use the four-file pattern
in phosphene-port/ : reference (transcribed from cited source, human-confirmed),
subject (independent), a mutant reproducing a plausible defect, a check that
passes the subject and rejects the mutant. Paste the source lines before
porting. Never widen a tolerance or wrap a failing case to reach green; if a
check is red, answer WHY in words before editing anything.

## Behavior is judged by the human, not the machine
The user is the frame diff. Do not build a frame-diff, a visual comparator, or
any behavioral oracle. Produce code that passes the mechanical gate; the user
decides if it does the right thing.
