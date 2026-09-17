# Launch Auditor — visual identity

Pulled from what's already shipped, not invented from scratch — the
dashboard's CSS and the field report artifact already agree on almost
everything. One real inconsistency between them is called out below rather
than papered over. Use this as the reference before generating anything new
(a video, a deck, a one-pager) — your friend's advice was right.

## The one-line idea

**A forecast that can't be edited after the fact.** Everything visual should
serve that: precision, evidence, a record that existed before the outcome did.
Not hype, not a "moon" aesthetic — closer to an instrument panel or a lab
notebook than a trading meme.

## Color

**Primary palette (from the live dashboard, `apps/web/public/style.css`) — use this as canonical:**

| Token | Hex | Use |
|---|---|---|
| Background | `#0b0f14` | page base |
| Raised surface | `#11161d` | cards, header |
| Card | `#141a22` | panel fill |
| Border | `#232b36` | hairlines |
| Text | `#dde3ea` | primary text |
| Text, dim | `#8592a3` | secondary |
| Text, faint | `#5b6675` | tertiary / empty states |
| **Accent** | `#5ee6c8` | links, the brand mark, active states — a cool signal teal/mint |
| Accent, dim | `#2f7a6c` | accent on dark fills |
| Good | `#6fd68a` | verified / passing |
| Warn | `#e8b95e` | stale / attention |
| Bad | `#e8697a` | broken / failing |

**A known inconsistency, flagged rather than hidden:** the field report artifact
(`Launch Auditor Field Report`) uses a *second*, different accent — a warm
amber/rust (`#A85B15` light / `#E09246` dark), plus a serif display face
(Fraunces) the dashboard never uses. Both are well-executed on their own, but
they don't read as the same product next to each other. **Recommendation:**
treat the dashboard's teal as the one brand accent going forward — it's the
surface people actually use, day to day, and it's what "verified" and "live"
mean visually on the site. Reserve the warm amber only if you deliberately
want a print/narrative document to feel distinct from the live product; don't
let it drift in by accident on the next piece.

## Typography

- **IBM Plex Mono** — every number, every address, every proof hash, every
  piece of data. This is the "this is real, checkable" typeface. Tabular
  figures where numbers are compared.
- **IBM Plex Sans** — everything else: labels, prose, captions.
- No serif in the product itself. If a narrative one-off wants Fraunces for a
  headline (as the field report did), that's a deliberate departure for a
  specific document, not the default.

## Motifs — what's already been drawn on, reuse these

- **The hash chain.** Every lifecycle row folds into the last one. Visually:
  linked nodes, a chain, a sequence where breaking one link is visible.
- **Commit-before-outcome.** A timestamp or a stamp landing *before* a result
  is revealed — the core proof. Good for a "before/after" visual beat.
- **The Merkle tree / batch.** Many small things (reports) resolving into one
  anchored thing (a root, a transaction). Useful for "many forecasts, one
  proof."
- **The scorecard.** Predicted vs. realized, side by side, graded — not a
  chart pretending to predict the future, a chart looking backward at whether
  a past forecast was right.
- **Precision over drama.** Numbered probabilities (`62%`, `34%`), not vague
  risk bars. The product's whole differentiator is specificity — the visuals
  should never round that off into a generic "risky/safe" gauge.

## Voice

Calibrated, not hyped. States sample sizes next to every claim. Says "not yet
proven" as readily as it states a result. Never says "rug," says the
mechanical thing that happened instead. This is already how every doc in the
repo is written — the visual identity should feel like the same author made
both.

---

## A tailored prompt, ready to hand to a video tool

Your friend's template was built for a different kind of story (people
pooling resources into a shared representative) — Launch Auditor's actual
story is watch → forecast → commit → grade, so the beats below are rewritten
for that, keeping his production guidance (character/continuity rules,
typography rules, deliverables list) since those transfer directly.

```
Create an original 24–30 second animated explainer for Launch Auditor, showing
how it forecasts new token launches and proves it was right — or wrong — after
the fact.

Creative direction
Elegant editorial motion graphics, not photoreal, not meme-crypto. Deep near-
black background (#0b0f14), fine cream/light-gray line work, one accent color:
a cool teal/mint (#5ee6c8). Spacious, cinematic composition. Tone: precise,
quietly confident, instrument-panel calm — not hype.

Story
1. The chaos. A field of small glowing dots appears rapidly across the dark
   background — new tokens launching, dozens per second. Caption: "Thousands
   of new tokens launch every day. Most are worth nothing by tomorrow."
2. The forecast. One dot is singled out. A precise readout appears beside it —
   three numbered probabilities in Plex Mono, e.g. "62% insider exit, 6h ·
   34% drawdown, 24h · 27% still trading, 24h" — appearing character by
   character, like a printer.
3. The stamp. The readout compresses into a small hash (a string of hex),
   which drops into a chain of identical linked shapes already stretching off
   screen — each link snapping into place with a soft, mechanical click. This
   IS the commit: an unmistakable "this happened, and can't be quietly
   changed" beat. Caption: "Every forecast is signed and locked in — before
   anyone can know the answer."
4. Time passes. A subtle visual signal — the chain link's glow shifts, or a
   small clock/calendar motif ticks forward — no literal clock face needed if
   motion alone reads as elapsed time.
5. The grade. The original probability readout reappears next to what
   actually happened, styled as a simple two-column scorecard: forecast vs.
   real outcome, with a small checkmark or accent-colored tick where they
   line up. Caption: "Then it grades itself — in public, against what
   actually happened."
6. Brand resolution. "Launch Auditor" wordmark in Plex Sans, small teal
   accent mark, tagline: "A forecast that can't be edited after the fact."
   Hold for at least 3 seconds.

Animation and production
- Keep the chain-link motif visually identical every time it appears (same
  shape, same material) — it's the through-line connecting every scene.
- Smooth, deliberate easing; no bouncy/cartoonish motion — this is a precision
  instrument, not a mascot.
- Numbers and hashes render in a true monospace typeface (IBM Plex Mono),
  never faked with a generic sans.
- Restrained camera movement: slow push-ins, no whip pans.
- Original, understated score — mechanical, ticking, printer-like sound cues
  on the stamp/commit beat; a single warmer swell only at the brand resolution.

Typography and clarity
Short captions, one idea per scene, high contrast, generous margins. Numbers
carry the story — avoid decorative typography that competes with the data
itself. Legible at phone width. No unsupported claims, no guaranteed returns,
no "moon" language.

Deliverables
Storyboard and style frames first, for approval, before full animation.
Then: polished 1080p with sound, a silent version (captions carry it), a
poster still, and a separately composed vertical/mobile cut.
```

Send the storyboard/style-frame step back here before approving full
animation — cheap to redirect at that stage, expensive after.
