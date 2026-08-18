# Lumina Source of Truth

Instantiated from [studio-ops/templates/SOURCE_OF_TRUTH_TEMPLATE.md](https://github.com/klefner/studio-ops/blob/main/templates/SOURCE_OF_TRUTH_TEMPLATE.md).
See [studio-ops/AGENTS.md](https://github.com/klefner/studio-ops/blob/main/AGENTS.md) for the shared rules
this file exists to support.

## Current State As Of 2026-08-16

| Layer | Current value | Meaning |
| --- | --- | --- |
| Canonical repo | `klefner/lumina` on GitHub | No local-only or OneDrive-style checkout involved — GitHub is the whole story for this repo. |
| Active development branch | `claude/lumina-game-build-dupma4` (or a fresh branch cut from current `main` for each unit of work) | Feature/fix work lands here, then merges to `main` via PR. |
| Is `main` current? | Yes | Every merged PR this project has shipped went through squash-merge into `main`; `main` is always the real state. |
| Current build/version label | Short commit hash of the latest squash-merge commit on `main` | e.g. `932d6f1` |
| Live deploy URL (canonical) | `https://lumina-8f0.pages.dev/` | Cloudflare Pages — the primary deploy target and the one to check for build-freshness (see verification method below). No personal name in it, unlike the GitHub Pages URL below. |
| Live deploy URL (secondary mirror) | `https://klefner.github.io/lumina/` | GitHub Pages. Kept running alongside Cloudflare Pages as a free fallback — useful if Cloudflare ever has an outage. |
| Promoted share URL | `https://draclif.itch.io/lumina` | The itch.io storefront page — the link actually baked into the in-game postcard/share text (see `CANONICAL_SHARE_URL` in `game.js`) and the one to hand someone (Reddit/X/etc). Pushed automatically on every merge to `main`, via `.github/workflows/deploy-itch.yml`, same as the two hosts above. (PR #78, 2026-08-10, briefly gated this behind a manual `workflow_dispatch` click to keep unreviewed builds off the storefront; reverted 2026-08-16 because that click requires `actions:write`/dispatch permission, which no session working this repo has ever actually had — see the incident note below and PR #78's own follow-up discussion. The manual dispatch trigger is still available for redeploys/rollbacks of an older commit, just no longer required for normal shipping.) |
| Live deploy verification method | `curl https://lumina-8f0.pages.dev/version.json` (or the github.io / itch.io URLs) and compare the `build` field to the latest commit hash on `main` | All three hosts deploy straight from `main` on every push; this is a direct, mechanical check anyone (human or AI) can run themselves. |
| Deploy source (branch / folder) | `main`, staged into `_site` independently by `.github/workflows/deploy-pages.yml` (GitHub Pages + Cloudflare Pages) and `.github/workflows/deploy-itch.yml` (itch.io) | Not the whole repo root — each workflow's staging step copies an explicit allowlist (`index.html`, `game.js`, `style.css`, `manifest.json`, `version.json`, `icons/`, `sounds/`, `art/`) into its own `_site`. A file being on `main` is **not** enough on its own to make it live — check the copy list in both workflows. The Cloudflare Pages deploy step is gated to `github.ref == 'refs/heads/main'` so a manual `workflow_dispatch` from any other branch can never overwrite production (see PR #28); deploy-itch.yml carries the same guard. |

## Non-Negotiable Distinctions

- A commit existing on a feature branch is not the same as it being on `main`.
- A file being on `main` is not the same as it being in the deployed site — only what each deploy workflow's staging step explicitly copies into `_site` ships. Adding a new player-facing file (a new asset, a new split-out JS module) to `main` without also adding it to that copy list will silently never go live. This file (`SOURCE_OF_TRUTH.md`) and `AGENTS.md` are deliberately **not** on that list — they're developer/agent docs, not meant to be served to players.
- `main` being current is not the same as GitHub Pages/Cloudflare/itch.io having finished deploying it yet — always verify via each host's own `version.json`, not by assuming the push landed instantly.
- After a squash-merge, a local feature branch's pre-squash commits diverge from the new squashed commit on `main` (same content, different hash). Re-sync with `git fetch origin main --force && git checkout -B <branch> origin/main` before starting new work, rather than trying to rebase or reuse the old branch history.
- The GitHub token available to a Claude session working this repo has `contents`, `pull requests`, and `issues` write access, but **not** `actions:write`/workflow-dispatch. Any design that requires an agent session to trigger a `workflow_dispatch` run (rather than a plain push/merge) as a normal step of shipping will silently become a manual-only, human-blocking step — confirmed structural, not a transient token issue (see the 2026-07-31 incident below, which predates and is unrelated to the itch.io-specific gate that PR #78 later added and this file's 2026-08-16 update removed).

## Required Method: Grounding a Cutout on a Real-Photo Scene

Any scene that composites a foreground cutout (a tree, an animal, a boat) onto
a real photo background at a computed anchor point (a "horizon line," "ground
line," "water line," etc.) MUST go through the checks below before shipping,
AND MUST add automated test coverage for the categories that are testable
(most of them are) rather than relying on a one-time visual pass. This is not
optional overhead — it exists because prose review, and then a test-backed
method that itself grew incrementally, failed on the exact same underlying
complaint ("a tree is floating over the water") **nine separate times**
before the actual, complete root cause was found:

1. Shore palms anchored at `horizonY` (the water/sky line) with nothing drawn
   under them — read as trees floating in the air, over the water.
2. `horizonY` anchor was correct in principle, but the crown-only cutout had
   no trunk of its own reaching that anchor point — still read as floating.
3. `HORIZON_FRAC.night` itself was flat wrong (0.672 instead of 0.903) — a
   single-column brightness-gradient scan locked onto a bright star instead
   of the real, much subtler, sky-to-sand transition.
4. Even after fixing the measurement, the region between the (now correct)
   horizon and the sand was real photographed SAND, not water — nothing in
   that band read as water at all, because the photo shows none there.
5. Two more bugs, in the same screenshot, that a prose-only review of the
   round-4 fix still missed: (a) draw order was chosen by how fast each
   element *moves*, not by which is nearer the camera, so a fast-moving-but-
   far cruise ship drew on top of (visibly nested inside) a static-but-near
   palm tree whenever their independently-random x positions overlapped; (b)
   the corner-hanging overhang frond's trunk, sized down in an earlier round
   to fix an unrelated "too large" complaint, no longer reached anywhere near
   a screen edge — it just stopped in open air, unsupported, the same failure
   as #2 above wearing a different asset.
6. The overhang's trunk was then cropped out of the source image entirely
   (round 5b's fix), verified by measuring contiguous opaque-pixel run
   lengths at the new crop edge — but that crop's *first* attempt still left
   a real ~30px trunk column at the bottom edge that a render-and-look pass
   missed and a PR reviewer (Codex) caught; a second, more thorough crop
   fixed it, re-verified the same measured way.
7. With the trunk genuinely gone, nothing related the crown's own vertical
   extent to the horizon/water line at all — on some Ken Burns pan states the
   crown extended down into the water, reading as a tree growing out of the
   open ocean. Fixed by clamping rendered height to a safe margin above
   `waterTopY`; the same unclamped-Y gap was independently confirmed to
   affect the sun/moon on wide-enough canvases and fixed identically. Both
   clamps were verified correct by instrumenting the actual draw call and
   confirming the real numbers reaching it (not just reasoning about the
   formula) — and they were, in fact, correct.
8. Investigating a further report of the SAME "tree in the ocean" look after
   the round-7 clamp shipped led first to a wrong-but-plausible explanation:
   a shore palm's independently-random `xFrac` happened to land almost
   exactly under the overhang's corner, and the two — each individually
   correct on its own terms — visually combined into one impossibly tall
   tree spanning sky to sand through the water. This was real (confirmed by
   instrumenting both elements' actual x/y/height values against the visual
   output) and was fixed (biasing shore-palm placement away from whichever
   corner the overhang used that wave, statistically confirmed 0 violations
   across 5,000 generated scenes) — but it was not the cause of what the
   *next* screenshot showed.
9. A fresh render at the exact worst-case scenario, with the round-7 clamp
   AND the round-8 placement bias both verifiably in effect, **still looked
   like a floating tree with a trunk dangling over open water.** That
   discrepancy — two independently-verified fixes in effect, on a scene that
   still visibly failed — is what forced opening the asset file directly
   instead of trusting another round of position math. `palm-overhang.webp`
   turned out to be a photo shot straight up from underneath the tree:
   fronds radiating in a full circle around a centered coconut cluster,
   symmetric, with zero opaque pixels on its own top row or right-edge
   column. It never touched the corner it was drawn anchored to, at any
   crop, size, clamp, or placement bias. Rounds 2 and 5–8 had each fixed a
   real, independently-measured defect — and none of those fixes were
   wrong — but all of them were patching symptoms of a premise that was
   false from the start: that this particular photo read as "anchored to a
   corner" at all. It didn't, and no amount of position correctness could
   fix a shape problem. The element was removed rather than re-sourced a
   fifth time (see `art/CREDITS.md`'s `palm-overhang.webp` entry for the
   full account, and category 5 below for the check that should have caught
   this before round 1 ever shipped).

Round 5 is why this section stopped being a checklist run once by eye and
became a set of things you write **actual automated tests** for. Round 9 is
why the checklist itself needed another category: passing every existing
check, including ones verified by direct instrumentation of real numbers and
not just reasoned about, is not sufficient if the checks themselves have a
blind spot. A human (or an AI) reviewing a screenshot reliably stops looking
once it has found *one* plausible explanation for what's wrong — confirmed
directly in this repo's own history, more than once in the same conversation,
including at the instrumented-numbers level in rounds 8 and 9. A checklist
you apply by eye has the same failure mode as the code it's reviewing: it's
only as exhaustive as your attention was that day, AND only as exhaustive as
the categories you thought to write down. An enforced test suite doesn't get
tired and doesn't stop at the first hit — but it also can't check a category
nobody defined yet, which is exactly what happened here for three rounds
running (7, 8, and 9 each exposed a category — region containment, compound
placement, and asset composition — that the method didn't have yet).

**The eight rubric categories, and how each one is actually enforced:**

1. **Contact** — does the cutout asset's own visible content reach the edge
   it's anchored at? Testable and enforced: `tests/smoke.spec.js`'s "Every
   ground/water-anchored cutout touches its own bottom edge" test loads
   every ground/water-anchored cutout in both the Beach and Safari libraries
   into an offscreen canvas and checks that real, non-trivial alpha (>150,
   not just barely-non-transparent anti-aliasing) exists somewhere in its
   own bottom 3% band. **Any new cutout added to either library, or any new
   photo-scene's cutout library, must be added to this test's asset list.**
   Calibrating that threshold is itself part of the method, not a one-time
   guess: this test's first real run caught `dolphin.webp` (peak alpha 40 in
   that band — genuinely near-empty; the tail's *solid* content stopped well
   short of the crop edge, leaving faint splash mist and daylight between it
   and the water line) and correctly left `tree-baobab.webp` alone (peak
   alpha 168 — a real, substantial root base fading into a soft photographed
   ground-shadow, confirmed fine by rendering it against a reference line at
   its own anchor point). Re-tune the threshold with the same
   render-and-look verification if a future asset sits ambiguously near it,
   not by guessing a new number.
2. **Medium legibility** — is the surface an element is anchored to/in
   visually distinguishable in the actual rendered pixels, not just
   mathematically positioned there? Not generically automatable (it depends
   on what a specific photo shows) — verify per photo, and if the photo
   doesn't make the medium legible on its own (Beach's night photo shows no
   visible water surface at all), add a deliberate rendered treatment (a
   tinted gradient) rather than relying on an unaided dark photo.
3. **Depth order** — for every pair of elements whose position ranges can
   overlap on screen, does draw order put the nearer one on top? Testable
   and enforced: define an explicit, ordered, farthest-to-nearest depth
   model as actual code (`BEACH_DEPTH_LAYERS` in `game.js`), give every
   foreground-drawing code path a named function so a test can hook it
   (`drawBeachCutout`/`drawBeachBoat` — no more raw `ctx.fill()` calls
   inlined directly in the scene function, precisely because that can't be
   hooked), then assert in a test that the actual
   sequence of layers drawn in a real frame never goes backwards through
   that model. Backed by a second, narrower regression test that forces two
   elements to the exact same x — don't rely on random sampling to
   *happen* to hit the collision case; force it. **Any new scene with more
   than one foreground layer needs its own depth model constant and this
   same pair of tests**, not just Beach's.
4. **Off-canvas justification** (only for cutouts deliberately cropped
   mid-asset on the assumption "it continues off-frame") — does the cutoff
   point actually land at/near a real canvas edge across the cutout's whole
   production size range, not just the range it was designed at originally?
   No asset currently uses this pattern (the one that did, the Beach
   overhang frond, was removed rather than fixed a fifth time — see the
   round-by-round account above). Still without a full automated check (the
   geometry depends on where in the source image the deliberate cut point
   falls, which isn't recorded anywhere) — if this pattern is ever attempted
   again, category 5 below is a mandatory prerequisite check before this one
   even applies, and this category still requires rendering the element at
   its current size/position extremes and looking at a crop of just that
   element on top of that.
5. **Composition matches anchor role** — for ANY cutout anchored to
   something other than a real, photographed ground/water contact surface
   (screen-corner or screen-edge anchoring, category 4's whole premise) —
   does the asset's own alpha channel actually have real opaque content on
   the specific edge(s) the anchor claims it touches or exits through? This
   is the category that would have caught the overhang frond before round 1
   ever shipped: it was anchored as if hanging from a screen corner, but had
   zero opaque pixels on its own top row or right-edge column — a photo
   shot from directly underneath the tree, symmetric, touching no edge of
   its own crop at all. Testable and cheap, same technique as category 1
   just aimed at a different edge: scan the specific row/column the anchor
   claims contact with for real opaque content (alpha>150), not inferred
   from what the crop "should" contain. **Run this BEFORE wiring any
   corner/edge-anchored asset into a scene, not after a symptom is
   reported** — categories 1 through 4 can all pass individually while this
   one fails, because they check position math and per-defect symptoms, not
   whether the asset's own shape ever supported the anchor claim at all.
6. **Region containment** — for any element whose screen position is decided
   independently of `horizonY`/`waterTopY` (a corner-anchored overhang, a
   sun/moon placed by a plain screen-space fraction), is its rendered extent
   ever clamped against that boundary, and is the clamp verified with the
   REAL numbers reaching the draw call (via instrumentation), not just
   reasoned about from the formula? Testable per-element: assert the clamped
   value stays on the correct side of the boundary across the full
   `sizeFrac`/position range and a wide canvas-shape matrix (including
   ultrawide, where `horizonY`'s own containing clamp is most likely to sit
   at its extreme). Confirmed correct-but-insufficient in round 7 above —
   necessary, not sufficient, if category 5 hasn't also been checked for the
   same element.
7. **Compound/combinatorial placement** — for any two elements positioned
   completely independently of each other whose on-screen ranges can
   overlap, can that overlap combine two individually-correct elements into
   a nonsensical compound shape (e.g. a gap between them that happens to
   line up with the water, reading as one impossible object spanning both)?
   Different from category 3 (depth order): that category asks "does the
   nearer one occlude the farther one correctly," this one asks "should
   these two even be allowed to line up like this regardless of which is on
   top." Testable per pair: bias or hard-constrain their position ranges
   apart, then statistically confirm zero violations across many thousands
   of generated scenes (not just a handful of samples) — the check applied
   in round 8 above before the element it protected was removed entirely.
8. **Relative scale plausibility** — for any two elements that share an
   anchor point/line (same `waterFarY`, same horizon, etc.), do their
   `sizeFrac` ranges preserve real-world relative scale, so an unlucky pair
   of independent random draws can never make the smaller-in-reality thing
   render bigger? Player report, screenshot: a dolphin rendered visibly
   bigger than the cruise ship — both anchor at the identical `waterFarY`,
   so `sizeFrac` was the only cue separating "huge vessel, far at sea" from
   "small animal near the surface," and the dolphin's (0.05–0.07) and
   ship's (0.05–0.075) ranges overlapped almost entirely. Different from
   category 7: that one is about position ranges combining into an
   impossible compound shape; this one is about size ranges alone breaking
   a real-world scale relationship even with positions handled correctly.
   Testable and enforced, and deterministically rather than statistically
   where possible: extract the ranges into named `BEACH_CONFIG` constants
   (`DOLPHIN_SIZE_FRAC`, `CRUISE_SHIP_SIZE_FRAC`) instead of inline random
   literals, then assert the smaller element's ceiling stays below the
   larger element's floor by comparing the constants directly — no need to
   sample when the invariant is meant to hold by construction. Backed by a
   statistical check over thousands of actual `generateBeachScene()` calls
   as well, in case a future edit changes how `sizeFrac` is drawn from the
   range without updating the range itself.

**Whenever any of the above changes** (a new cutout, a new scene, a changed
`sizeFrac` range, a changed anchor formula), re-run the relevant tests AND
re-verify anything in categories 4–5 by eye/direct pixel inspection — a
passing test suite from before the change is not evidence about the change
itself. Two things must hold before considering photo-composited work in
this repo done: `npm test` passes, AND every category-4/5 element for
anything touched has been rendered (or had its edge pixels inspected) since
the change, not just reasoned about.

Safari and Forest use the same `HORIZON_FRAC`-anchored architecture as Beach
(`SAFARI_CONFIG.HORIZON_FRAC`/`drawSafariScene`). They were audited against
this method on 2026-08-17 (see the dated entry under Known Open Risk Areas
below for the result) and their cutout library is now covered by the
category-1 test above — re-run the full method again for either scene if
their source photos, `HORIZON_FRAC` values, or cutout library ever change.

## Known Open Risk Areas

- The audio "no sound" fix (sample-loading race + AudioContext resume hardening, shipped in PR #18) is verified by automated tests but not yet confirmed against a real device that's had an actual interruption (phone call, notification) mid-session — see the Beta Group 2 readiness checklist for the full context.
- The wide-playfield/zoom-out onboarding mechanic (PR #20) is covered by Playwright but not yet confirmed on a real touch device's pinch-zoom/pan gestures.
- One-off incident: the PR #42 merge deploy (2026-07-31) hit a transient Cloudflare API 522 on the "Deploy to Cloudflare Pages" step while the GitHub Pages step in the same job succeeded, leaving `lumina-8f0.pages.dev` briefly stale relative to `klefner.github.io/lumina/`. Resolved with a fresh push to `main` to re-run the whole job (neither `rerun_workflow_run` nor `workflow_dispatch` were available to the token used, 403). Single occurrence so far — not worth permanent dual-host verification unless it recurs. See the Non-Negotiable Distinctions entry above for why that same 403 shaped the 2026-08-16 itch.io auto-deploy revert.
- 2026-08-17 audit result (see "Required Method: Grounding a Cutout on a Real-Photo Scene" above, the method this audit was run under): Safari and Forest were both checked against the four rubric categories and found clean, no fix needed. Safari — both `HORIZON_FRAC` values (`{ day: 0.80, night: 0.87 }`) visually confirmed against actual crops of `safari-day.jpg`/`safari-night.jpg`; all five cutouts (`tree-acacia`, `tree-baobab`, `animal-zebra`, `animal-giraffe`, `animal-elephant`) include their own full base/legs down to the ground, no crown-only or feet-cropped assets; `safari-night.jpg` (unlike `beach-night.jpg`) shows a real lit, visible ground plane at its horizon, not near-total darkness, so no synthetic medium treatment is needed there; six renders (day/night × early/mid pan phase × portrait/wide canvas) all showed animals and trees correctly grounded. Forest has no `HORIZON_FRAC`, no ground-anchored cutouts, and no per-photo anchor math at all — just a Ken Burns pan/zoom, a moon, and fireflies placed in plain screen-space fractions — so it's structurally immune to this whole bug class, not just currently bug-free.
- **Closed by removal (2026-08-18, superseding an earlier same-day "Resolved" note that turned out to be premature)**: Beach's `palm-overhang` (the corner-hanging frond) went through nine total rounds of the same underlying "tree floating over water" complaint — a missing trunk, a wrong horizon measurement, a missing water treatment, a depth-order bug, a floating trunk stub, a second unremoved trunk remnant (caught by a PR reviewer, not by this repo's own render-and-look pass), an unclamped region-containment gap, a compound-illusion overlap with a shore palm, and finally the actual root cause: the source asset was never a corner-anchored composition at all (a symmetric photo shot from underneath the tree, zero opaque pixels on its own top row or right-edge column). Every fix before the last one was independently real and independently verified — and none of them could have worked, because the premise under all of them was false. See the "Required Method" section above (now nine rounds, seven rubric categories) for the full account, and `art/CREDITS.md`'s `palm-overhang.webp` entry for the asset-level history. Removed the element entirely rather than attempt a fifth re-crop or re-source: `BEACH_CUTOUT_SOURCES`, `drawBeachOverhang`, `BEACH_DEPTH_LAYERS`'s `palm-overhang` entry, the `palmOverhang` scene field, and the shore-palm placement bias that existed only to avoid it are all gone from `game.js`; `art/beach-cutouts/palm-overhang.webp` is deleted. Categories 4, 5, and 7 (off-canvas justification, composition matches anchor role, compound/combinatorial placement) currently have no asset in either Beach or Safari that they apply to as a result — they stay documented for the next time screen-corner/edge anchoring or independently-overlapping elements are attempted, with category 5's edge-opacity check now a mandatory prerequisite before category 4 even applies. Category 6 (region containment) remains live and in effect: the sun/moon clamp against `waterTopY` this round's investigation also added stays in place regardless of the overhang's removal, since it protects a still-shipping element.
