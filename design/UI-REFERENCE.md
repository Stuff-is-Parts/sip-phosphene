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
   is exempt — it is the focal point by design (palette.site).
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

## Current spec (implemented in phosphene.theme.css + page CSS)

- Surfaces: page #06080f · panel #0c1018 · raised #131926 · border #1d2536
- Text: normal #dde4f5 · quiet #7a86a0 · link #7ce7ff
- Loud elements: wordmark (Orbitron 20px cyan, text glow) and the primary
  action (brand-filled button with inline box-shadow glow) — Save .phos in
  the studio, START in the player splash. Everything else: no glow.
- Buttons: quiet tier is dark fill + visible border (WA appearance
  "filled-outlined" on neutral tokens); brand-quiet tier (cyan text/border,
  dark fill) for secondary brand actions.
- Scope: full-width raised instrument card, inset near-black screen,
  segmented meters (6px cells, 2px gaps, peak cell white) with live value
  digits beneath, log-frequency spectrum in the cyan family, raw waveform
  in neutral white.
