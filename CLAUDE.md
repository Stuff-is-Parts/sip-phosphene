# Required Project Context

Before performing any work, read these in order:

1. [PHOSPHENE-GOAL.md](PHOSPHENE-GOAL.md) — the governing goal: what to
   build, source authority order, exactness standard, native implementation
   boundary, completion conditions.
2. [WITNESSED-FAILURE-MODES.md](WITNESSED-FAILURE-MODES.md) — the twelve
   failure modes you exhibited on this project's prior attempt, with the
   mechanism, witnessed instance, and defeat for each. Read it as evidence
   about yourself, not as general advice.
3. [portable-verification-framework/](portable-verification-framework/) —
   the verification framework governing all implementation. No behavioral
   claim passes without the evidence chain it requires. Expected values
   originate from the strongest available oracle, never from your reading
   of source code.

The repository was deliberately reset on 2026-07-16. Prior implementation,
tests, evidence files, and documentation exist only in git history and are
historical claims, not authority (framework §26). Do not recover or trust
them without re-registration through the framework's authority and evidence
rules. The prior evidence files provably failed byte-exactness; re-acquire
raw authorities mechanically (pinned-revision fetch, recorded hash), never
by retyping content.

Do not approximate unsupported behavior. Implement it from authoritative
evidence or report the concrete unresolved requirement and leave it FAIL.
