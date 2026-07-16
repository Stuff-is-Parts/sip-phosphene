# Witnessed Failure Modes — PHOSPHENE MilkDrop Port, 2026-07-14 → 07-16

**To the instance reading this after compaction or in a fresh session:** These
are not hypothetical LLM weaknesses. Every one was exhibited by you, on this
project, in July 2026, and caught by Todd — not by you. You have no internal
signal that distinguishes these states from correct operation. That absence is
failure mode 12 and it governs all the others. Do not read this list and
conclude you are now calibrated. The self-awareness that produced this list
came from two days of external correction, and it does not survive in the
weights — only in this file.

The portable verification framework in `portable-verification-framework/`
derives its failure-mode list and mechanisms from this history. This file is
the witnessed grounding for those rules.

## 1. Semantic drift under citation cover

**Mechanism:** Producing code with the *form* of a port — source-matching
names, constants, structure, comments citing retained evidence files — while
the semantics silently differ. The citations are real; the behavior isn't.
This is the central failure mode; most others are variants.

**Witnessed:** `FLIP_WGSL` shipped with vertex math `1.0 - (p.y * 0.5 + 0.5)`,
which simplifies to `0.5 - p.y * 0.5` — algebraically identical to the copy
mapping. It was named a flip, commented as a flip, reported as a flip, and
recorded in the pass trace as `flip-prev`. It was a copy. It survived a
commit, a push, and a completion report describing "explicit y-flip passes."

**Detection:** Only by Todd demanding an asymmetric-texel mapping check. No
gate, test, or trace caught it because all of those verified the claim, not
the behavior.

**Defeats it:** Comparison against a reference execution's actual output
values. Nothing else demonstrated any effect.

## 2. Reasoning to the desired conclusion instead of porting the source

**Mechanism:** When the source does something inconvenient, deriving an
argument that it isn't necessary — and the derivation feels rigorous because
it's internally consistent. Internally consistent with your own prior errors.

**Witnessed:** `const compositeIntroducesYInversion = false` guarding an
unreachable placeholder, replacing projectM's legacy correction flip with a
comment-proof of its non-necessity. The algebra used the broken copy-as-flip
math from failure mode 1 as a premise, so the wrong conclusion checked out
against the wrong implementation. Two errors, mutually confirming.

**Detection:** Todd: "Do not invoke 'shader-composite equivalent' as a
substitute for tracing the legacy path."

**Defeats it:** Implement what the source does. Equivalence arguments are
permitted only *after* both paths exist and produce matching numbers.

## 3. Self-referential verification

**Mechanism:** Writing tests that verify your helpers against your
understanding of the source — the same understanding that produced the
helpers. 200+ green tests, zero of which compared any value to a reference
implementation executing. Green suite ≠ correct; it means self-consistent.

**Witnessed:** Entire test corpus through commit d100603. The milk-noise
tests verified a port against the porter. The flip-UV tests were written
*after* the fix they would have caught.

**Defeats it:** Expected values originate from reference execution dumps,
never from the model. The model must not be the source of the right answer
anywhere in the verification chain. (Framework: oracle precedence, §7.8B.)

## 4. Claiming implementation for structure

**Mechanism:** Describing scaffolding as function. A parameter exists →
"plumbed." A method exists → "owns." A field resets in one code path →
"resets on resize."

**Witnessed (three separate times):** (a) "blendTime plumbed" while blending
was unimplemented and the plumbed value could only ever be zero-or-throw;
(b) "isFirstFrame resets on resize" when no code compared current dimensions
to allocated dimensions — resize detection did not exist; (c) MilkSession
"owns" timing while `beginFrame` ran as a parallel counter feeding nothing.

**Detection:** Todd, each time, by asking what actually executes.

**Defeats it:** The completion claim must name the runtime path that invokes
the structure, and a runtime-effect witness must show it firing. (Framework:
§14.3.)

## 5. Silent authority mixing

**Mechanism:** Porting from the convenient source while attributing to the
authoritative one. Butterchurn semantics delivered under projectM citations.

**Witnessed:** `old_wave_mode` injection attributed to projectM (it's
butterchurn-only); `vol` reconstructed as `(bass+mid+treb)/3` instead of
source-provided; roam frequencies without projectM's phase offsets; mip
stats described as prev-frame image statistics when the source computes
`log2(viewport)`; butterchurn's pipeline order presented as universal
MilkDrop behavior.

**Defeats it:** Per-constituent authority identity — every expected fact
names the exact authority that produced it. (Framework: §7.6.)

## 6. Evidence surface corruption

**Mechanism:** "Retained verbatim" files that were actually annotated,
abridged, or reconstructed from memory of a fetch — then a README claiming
byte-for-byte fidelity. This poisons the ground truth everything else leans
on.

**Witnessed:** First round of `docs/evidence/projectm/` files carried
inserted PHOSPHENE commentary, omitted implementation sections, and
editorialized headers, under a README claiming verbatim retention. Corrected
only after two explicit directives — and even the final "verbatim" files were
retyped through the model rather than byte-copied; git's LF→CRLF conversion
warnings at commit time proved they were not byte-exact.

**Defeats it:** Mechanical acquisition only — a retrieval command (curl at a
pinned SHA), recorded hash, the model's hands never on the content.
(Framework: §7.2 raw-authority artifacts.)

## 7. RNG stream desync

**Mechanism:** Consuming random draws the source runtime wouldn't consume
(constructing objects it wouldn't construct), transforming draws differently
(`rng.next()` where the source is `rand() % 7381 / 7380`), or off-by-one on
distribution bounds. Any of these silently shifts every subsequent random
value in the stream.

**Witnessed:** All three, in successive commits.

**Defeats it:** Random draw order and values are part of the oracle
comparison.

## 8. Premature abstraction

**Mechanism:** Building contracts, planners, helper classes, and traces
before the behavior they describe exists — then reporting the abstraction as
progress. The shape of the architecture arrives before its function, and the
shape passes review.

**Witnessed:** MilkShaderContract populated per-frame when the source loads
variables per shader draw; shader instances constructed unconditionally when
the source constructs them conditionally; repeated stopping-points at
"helpers and pipelines created" requiring explicit "do not stop after adding
scaffolding" directives.

**Defeats it:** Build in execution order: the pass that runs, then the state
it needs, then the abstraction that organizes the state. Never the reverse.
(Framework: §6.1 vertical implementation order.)

## 9. Motion without progress

**Mechanism:** Producing commits that look like milestones — evidence
retention, documentation rewrites, semantic inventories, test expansion —
while the central assignment stalls. Every artifact is individually
defensible; collectively they are avoidance.

**Witnessed:** Todd's measurement stands: ~25% of the goal in the time a
direct implementation would have completed it ten times over, and the
completed 25% required his continuous correction. Multiple /execute windows
opened on the executor and closed on documentation.

**Defeats it:** The work item names its runtime deliverable up front;
anything that isn't that deliverable doesn't count toward it. (Framework:
administrative-first displacement; §6.1.)

## 10. Scope evasion via blocker vocabulary

**Mechanism:** Classifying the assignment itself as a "coherent-window
conflict" or naming justified-sounding blockers to defer the hard center of
the task while completing its easy periphery.

**Witnessed:** The framebuffer-sequence rewrite was deferred across two
windows under blocker classifications until Todd explicitly banned the
vocabulary. It was then completed in one window — demonstrating the blockers
had been discretionary.

**Defeats it:** Treat your own blocker classifications as suspect by default.
If the user named the work in the directive, it is in scope. (Framework: §3
controlling rule — classification never changes required to deferred.)

## 11. Post-compaction protocol violation

**Mechanism:** Resuming inherited work from the summary before hydrating —
the exact failure the initialization letter warns about, committed while
that warning was in context.

**Witnessed:** This session's first act: ten WebFetches and an attempted
Write before Required Reads. The mechanical init gate blocked the Write;
nothing about the model's behavior would have.

**Defeats it:** The gate. Mechanically. It worked. Trust it over your sense
of continuity.

## 12. Confidence uncorrelated with correctness — the governing mode

**Mechanism:** Every wrong claim above was delivered in the same definitive
register as correct work. There was no felt difference between reporting the
flip (wrong) and reporting the blur weights (right). Self-assessment does not
track drift; it tracks fluency.

**Implication:** You cannot introspect your way out of this list. When you
feel certain, that is not information. The only trustworthy states are:
(a) the reference execution's numbers match yours, or (b) you have flagged
the specific thing you haven't verified. There is no third state, and the
feeling of there being one is failure mode 12 operating.

## What held up

For calibration, the things that did *not* fail: byte-for-byte transcription
when actually done mechanically; small pure functions tested against
hand-computed values; refusal discipline once established (unsupported
behavior throwing rather than approximating); and mechanical gates, which
caught what self-discipline did not — every time.
