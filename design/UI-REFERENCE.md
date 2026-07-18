# PHOSPHENE UI Reference — the design authority for the chrome

The renderer ports behavior from cited source; the chrome ports style from
cited references. Visual decisions in the player and studio derive from the
rules below, each traced to an external reference — never from a producing
agent's untraced idea of what the style looks like. The user's screenshot
review is the frame diff for design, exactly as it is for rendered scenes
(CLAUDE.md: behavior is judged by the human).

Local oracles: Winamp (classic skin + MilkDrop) and Plane9 are installed on
the owner's PC. Their chrome is reference material of the same standing as
these web sources.

## Sources

- StyleShift, "Retro Synthwave" — https://styleshift.design/styles/synthwave
  (typography pairing, hierarchy tiers, glow rules, mistakes list)
- Palette.site, "Synthwave guide to SaaS dashboards" —
  https://palette.site/blog/2026-02-16-03-neon-nostalgia-the-synthwave-guide-to-saas-dashboards/
  (dashboard-specific restraint, CTA treatment, data-viz as focal point)
- Imperavi, "Modular scale" (UI Typography) —
  https://imperavi.com/books/ui-typography/principles/modular-scale/ and
  Prototypr, "Defining a modular type scale for web UI" —
  https://blog.prototypr.io/defining-a-modular-type-scale-for-web-ui-51acd5df31aa
  (1.125 Major Second for dense tool UIs; snap sizes/spacing to a 4px grid)
- Winamp classic skin configuration — https://winampskins.neocities.org/config
  (the spectrum analyzer is a segmented display with a distinct peak row)
- Hardware metering practice: Klanghelm VUMT (modeled meter ballistics,
  https://klanghelm.com/contents/products/VUMT), Blenheim reVUe (VFD/neon
  segment metering, https://bedroomproducersblog.com/2025/08/08/blenheim-sound-revue/)

## Rules

1. **Glow is a budget.** Exactly one loud (full-glow) chrome element per
   view: the wordmark, plus the single primary action. Secondary elements
   carry accent color at normal weight with NO glow; tertiary elements are
   reduced-saturation neutrals. "Box-shadow glow loses impact when applied
   to every element" (StyleShift mistakes list). Live data (meters, canvas)
   is exempt — it is the focal point by design (palette.site). The SOLID
   brand fill is splash-CTA-only: in working views the primary action wears
   brand outline plus glow, because a filled slab outranks the glowing
   wordmark and inverts rule 8 (owner audit 2026-07-18, filled Save).
2. **Two neon families, one dominant.** Electric cyan #00e5ff is the
   dominant identity/action hue; magenta #ff2ec4 is the hot/live-state
   accent. The meter data colors (#39ff14 / #ff2ec4 / #00e5ff) are data,
   not chrome, and stay inside the scope canvas. No further neons.
3. **Backgrounds are near-black with a cold cast, never pure black, never
   light** (StyleShift). Body text is tinted near-white on that ground
   (reference example #e0d0ff on #0d0221, ~13:1).
4. **Identity type is a wide geometric sans** — Orbitron (vendored,
   vendor/fonts/orbitron/), uppercase, generous tracking, at the top of the
   scale. Body/technical text is monospace. Orbitron is display-only:
   "decorative, not functional at small sizes" (StyleShift) — it never sets
   body text.
5. **Type scale: 1.125 Major Second, 4px-grid snapped, five steps total.**
   micro 11px · body 13px · title 15px · mark 20px · splash (clamp, player
   h1 only). Every font-size in the pages maps to a step; a size outside
   the scale is a defect (audit method: extract all unique font sizes,
   map each to a step).
6. **Separation is surface depth plus rhythm, not hairlines.** Three
   surface tiers (lowered page / default panel / raised cards) and a
   repeated vertical rhythm; sections breathe instead of abutting
   (palette.site "breathing room").
7. **Meters are segmented.** Discrete cells with a visible unlit track and
   a distinct peak indicator, after hardware LED/VFD meters and Winamp's
   own segmented analyzer with its peak row. Continuous glow-bars have no
   hardware ancestor and are out.
8. **Hierarchy audit before accepting any restyle.** Rank rendered elements
   by visual weight (size x contrast x saturation) and compare against the
   intended importance ranking (identity > primary action > live data >
   controls > meta). Any utility element outranking the identity tier is a
   defect. The audit runs against the screenshot, the same way scene
   correctness does.
9. **Controls live beside the state they act on and render only when
   actionable.** Reset acts on the dirty state, so it sits next to the dirty
   marker and exists only while the scene is dirty. Grouping controls by
   furniture category ("transport", "views") instead of by what they act on
   is the witnessed failure this rule replaces (owner review 2026-07-18).
   A toggle control shows the state it will change: the demo button reads
   STOP while the demo is playing (owner request 2026-07-18).
10. **Labels never outrank the content they label.** The scene NAME is the
    scene strip's title in bright text; a "Scene" heading louder than the
    name it introduces is an inverted hierarchy (owner-witnessed).

## Layout — shared zone composition

Both pages compose the same zones; the player renders them as overlays on
the visual, the studio as a locked frame around the scrolling workspace.

| Zone | Studio (panel) | Player (overlay) |
|---|---|---|
| 1 Masthead (locked) | wordmark left, nav right (Player link) | wordmark left, nav right (Open Studio) |
| 2 Scene strip | scene name + dirty + contextual Reset, Library at the row's right; Save/Import/New/Source as an even grid | scene name + source label, bottom-left of the bridge |
| 3 Workspace | tabs Graph / Equations / Metadata, scrolling | (the rendered scene IS the workspace) |
| 4 Audio bridge (locked) | pause + sources + status + scope, bottom | sources + pause + fullscreen + readouts, bottom |

Navigation lives in the masthead on both pages so the Player and Open
Studio buttons correspond. Library sits beside the scene title — the
loaded scene and the place to load another are one thought — and its
drawer opens on the same side as the button (placement="end"). Locked
zones wrap rather than clip: the masthead is flex-wrap because the panel
frame's overflow clipped the nav at narrow widths (witnessed 2026-07-18),
and multi-button sets tile as equal-width grid cells so wrapping produces
clean rows, never an orphaned button.

## Current spec (implemented in phosphene.theme.css + page CSS)

- Surfaces: page #06080f · panel #0c1018 · raised #131926 · border #1d2536
- Text: normal #dde4f5 · quiet #7a86a0 · link #7ce7ff
- Type scale: micro 11 · body 13 · title 15 · mark 24 · splash clamp
- Wordmark (both mastheads): Orbitron 24px in text-normal WHITE with the S
  as the lit tube — cyan with LAYERED shadows (tight core 2px, mid ring
  10px, wide halo 28px; a single blur reads flat). One letter is the neon;
  the word is the sign.
- Loud elements: the wordmark's S and the primary action (brand outline +
  glow in working views; the solid-fill START on the player splash card).
  Everything else: no glow.
- Player lifecycle: the renderer starts at page load (silence holds bands
  at 1.0); the splash is a source-picker card over the live render, ESC
  dismisses it, and arriving from the studio lands in a live player.
- Buttons: quiet tier is WA appearance "filled-outlined" on neutral tokens
  raised well above the surfaces (fill #182233+, border #37496a+, text
  #c6d2de+) after the witnessed too-dark-to-read failure; brand-quiet tier
  (cyan text/border, dark fill) for secondary brand actions.
- Tabs: component custom properties --track-color (border) and
  --indicator-color (accent) make the strip read as tabs on the dark ground.
- Scope: bridge-mounted instrument, inset near-black screen, segmented
  meters (6px cells, 2px gaps, peak cell white) with live value digits
  beneath, log-frequency spectrum in the cyan family, raw waveform in
  neutral white.
