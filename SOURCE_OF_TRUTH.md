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

   **This test checks whether real content exists at the anchor edge, not
   whether that content is the semantically correct part of the object --
   those are different questions**, and only the first one is automatable
   without understanding what the image actually depicts. `cruise-ship.webp`
   passed this test the whole time: its bottom edge had plenty of real,
   solid alpha content. That content was a dock/pier the ship was moored
   to, not the ship's own hull -- `rembg` had kept the whole dockside
   structure as foreground (it's physically touching the hull in the
   source photo, reading as one continuous object), so the ship rendered
   with the dock's full height as a gap between its hull and the water
   (player report, screenshot: the ship consistently floating above the
   horizon). CREDITS.md's own sourcing note for this asset had confidently
   claimed "the dock/ropes... were cleanly removed by rembg" -- another
   claim, like `HORIZON_FRAC.day`'s, that had never actually been checked
   against the asset and was wrong. **Whenever a new cutout is added,
   visually inspect what's actually touching its own anchor edge (not just
   whether the alpha test passes) and confirm it's the object itself, not
   an attached structure the object happens to be resting against, tied
   to, or standing on** -- this is not generically automatable (it
   requires knowing what the photo depicts), so it stays a manual
   render-and-look step alongside category 2 below, not a test.
2. **Medium legibility** — is the surface an element is anchored to/in
   visually distinguishable in the actual rendered pixels, not just
   mathematically positioned there? Whether the medium itself needs a
   deliberate rendered treatment (Beach's night photo shows no visible
   water surface at all, so glitter/wave lines get a tinted gradient
   rather than relying on an unaided dark photo) is still per-photo manual
   judgment. But ONE piece of this category IS now testable and enforced,
   after it produced three separate bugs across this repo's history before
   getting a real check: **any `*_FRAC` constant that claims to mark a
   boundary between two regions in a source photo (HORIZON_FRAC,
   WATER_END_FRAC) must actually sit at a measurable brightness transition
   in that photo, not float in the middle of one uniform region.**
   `HORIZON_FRAC.night` was originally measured with a single-column scan
   that locked onto a star instead of the real horizon.
   `HORIZON_FRAC.day` (0.413) was simply never verified against
   `beach-day.jpg` at all -- accepted because renders "looked plausible in
   isolation" (nothing else in frame contradicted it, since the cruise
   ship would still be drawn somewhere within the visibly blue-green sea
   either way) -- until a player screenshot showed the ship rendering
   roughly halfway between the real horizon and the beach, and a fresh
   full-row brightness scan found the real transition at 0.278, not 0.413.
   The comment sitting right next to the old `waterBottomY` line even
   asserted, confidently and specifically, "day keeps using that real
   photographed water band unchanged" -- a claim that sounded like
   verified fact and had never actually been checked against the photo.
   `WATER_END_FRAC.day` didn't exist at all until the same round: once
   dolphins could roam the water freely, they were bounded by `sandY` (a
   fixed CANVAS fraction for a decorative color strip, never tied to
   photo content), which sat deep in real photographed dry sand -- a
   dolphin could render "on the sand" while every stored value stayed
   validly within its own [0,1] range the whole time. All three are now
   covered by `tests/smoke.spec.js`'s "Photo boundary fractions" test:
   loads the real source photo, samples average row brightness just above
   and below each claimed boundary, and asserts a real, sizable difference
   between them. While fixing this, also used the same test to check
   `SAFARI_CONFIG.HORIZON_FRAC.day` -- the 2026-08-17 audit (see Known
   Open Risk Areas below) had "visually confirmed" it once against a crop,
   the same kind of one-time-eyeballed claim that turned out wrong for
   Beach's day horizon, so it deserved the same automated check rather
   than trusting the prior audit's word for it. It's genuinely correct,
   but not for the reason assumed: raw brightness is nearly FLAT across
   that boundary (no usable jump at all) -- the real transition is a HUE
   shift, blue sky to tan grass, only visible by comparing the blue and
   green channels separately. Safari's night `HORIZON_FRAC` is honestly
   documented in its own comment as eyeballed from tree silhouette
   position, not a measured transition, so it's intentionally NOT in this
   test -- there's no brightness or hue jump to check there by design.
   **Any new `*_FRAC` boundary constant, for Beach, Safari, or any future
   photo scene, must be added to this test** (using whichever channel/
   metric actually shows the real jump in that specific photo -- confirm
   which one with a one-off measurement first, the way both of these
   were), not just spot-checked once and trusted from then on.
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

   **This category also applies WITHIN a single element's own position
   range, not just between two different elements.** Player report,
   screenshot, next round: after dolphins were given freedom to roam the
   whole water column (player request -- "dolphins can be anywhere in the
   water... only cruise ships on the horizon only") instead of being fixed
   to `waterFarY`, a dolphin near the horizon (small `yFrac`, meant to read
   as far out at sea) still rendered at its full, position-independent
   size — appearing as a large object high in the frame, next to a much
   shorter, clearly-nearby shore palm, reading as "jumping higher than the
   tree." The fix wasn't a new category, just this one applied more
   broadly: rendered size now scales with the SAME `yFrac` that decides
   position (0.4x near the horizon, up to the element's own full
   `sizeFrac` at the shore) — a real depth/perspective cue, and one that
   can only shrink an element relative to its own already-verified-safe
   size, never grow it, so the cross-element invariant above still holds
   at every position. Any future element given its own position freedom
   across a depth range needs this same self-consistency, not just a
   position-freedom check in isolation — "can be anywhere" and "renders
   the same size everywhere" are DIFFERENT claims, and shipping the first
   without checking the second is exactly what happened here.

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

- **Resolved (2026-08-18)**: `HORIZON_FRAC.day` (0.413) and the implicit assumption that `sandY` marked the real water/sand boundary were both wrong, discovered via player report/screenshot: the cruise ship rendering roughly halfway between the real horizon and the beach, and separately a dolphin rendering on real photographed sand. Neither had ever been verified against `beach-day.jpg` directly -- 0.413 was accepted on the strength of renders "looking plausible" (nothing else in frame contradicted it), and a comment beside the old `waterBottomY` line confidently asserted "day keeps using that real photographed water band unchanged," a claim that had never actually been checked. A fresh full-row brightness scan found the real horizon at 0.278 (not 0.413) and a new `WATER_END_FRAC.day` (0.49) marking where real water actually ends before wave-break foam/dry sand begins (previously conflated with `sandY`, a decorative canvas-fixed strip with no relationship to photo content). Both fixes verified by rendering the exact reported scenarios (ship across six pan phases, a max-depth dolphin) and inspecting real pixel output, not just re-deriving the formula. Closed the gap that let this go unverified for two rounds running: `tests/smoke.spec.js`'s new "Photo boundary fractions" test loads the real source photos and asserts every `HORIZON_FRAC`/`WATER_END_FRAC` constant (Beach day/night, Safari day) sits at a measurable brightness or hue transition, not floating inside one uniform region — see the Required Method's category 2 above for the full account, including why Safari's day value needed a hue-channel check instead of brightness (confirmed correct, but the earlier "visually confirmed" audit claim had never been backed by an automated check either).
- **Resolved (2026-08-19)**: `cruise-ship.webp` still rendered the ship floating well above the horizon even after the `HORIZON_FRAC.day`/`WATER_END_FRAC.day` fix directly above -- because the position math was never the problem this time. Player report/screenshot correctly guessed the cause: the asset itself included the dock/pier the ship was moored to (mooring bollards, a raised concrete walkway, a receding line of dockside lamp posts), all kept as real opaque foreground by `rembg` since it's physically touching the hull in the source photo. `drawBeachCutout` anchors the image's own bottom edge at the horizon, so the ship rendered with the pier's full height as a gap above the water. This passed the Required Method's category-1 "contact" test the whole time (real alpha content at the bottom edge, just not the ship's own hull) — see the Required Method's category 1 above for the new note this added: contact and semantic-correctness-of-the-anchor-edge are different questions, and only the first is automatable. First fix attempt cropped the pier out of the SAME docked photo -- verified at the time (full production size, multiple pan phases, both mirror directions) but a PR reviewer (Codex) caught that the crop line still left several receding dockside lamp posts standing in front of the lower hull, since that photo's pier runs the full width with no clean line separating it from the hull anywhere. Rather than attempt a third crop of a photo that structurally couldn't produce a clean result (the pier occludes the hull's real waterline everywhere in that source image), sourced a genuinely different photo showing the ship actually underway at sea (player: "find a cruise ship image that's at sea, not a dock") -- the same resolution pattern as the palm-shore-crown asset earlier in this project (a whole real photo beats patching a compromised one). Verified by rendering at full production size across multiple pan phases, both mirror directions, and both day/night tints. See `art/CREDITS.md`'s `cruise-ship.webp` entry for the full two-photo account, including the correction to an earlier sourcing note that had wrongly claimed the first photo's dock was "cleanly removed by rembg."
- The audio "no sound" fix (sample-loading race + AudioContext resume hardening, shipped in PR #18) is verified by automated tests but not yet confirmed against a real device that's had an actual interruption (phone call, notification) mid-session — see the Beta Group 2 readiness checklist for the full context.
- The wide-playfield/zoom-out onboarding mechanic (PR #20) is covered by Playwright but not yet confirmed on a real touch device's pinch-zoom/pan gestures.
- One-off incident: the PR #42 merge deploy (2026-07-31) hit a transient Cloudflare API 522 on the "Deploy to Cloudflare Pages" step while the GitHub Pages step in the same job succeeded, leaving `lumina-8f0.pages.dev` briefly stale relative to `klefner.github.io/lumina/`. Resolved with a fresh push to `main` to re-run the whole job (neither `rerun_workflow_run` nor `workflow_dispatch` were available to the token used, 403). Single occurrence so far — not worth permanent dual-host verification unless it recurs. See the Non-Negotiable Distinctions entry above for why that same 403 shaped the 2026-08-16 itch.io auto-deploy revert.
- 2026-08-17 audit result (see "Required Method: Grounding a Cutout on a Real-Photo Scene" above, the method this audit was run under): Safari and Forest were both checked against the four rubric categories and found clean, no fix needed. Safari — both `HORIZON_FRAC` values (`{ day: 0.80, night: 0.87 }`) visually confirmed against actual crops of `safari-day.jpg`/`safari-night.jpg`; all five cutouts (`tree-acacia`, `tree-baobab`, `animal-zebra`, `animal-giraffe`, `animal-elephant`) include their own full base/legs down to the ground, no crown-only or feet-cropped assets; `safari-night.jpg` (unlike `beach-night.jpg`) shows a real lit, visible ground plane at its horizon, not near-total darkness, so no synthetic medium treatment is needed there; six renders (day/night × early/mid pan phase × portrait/wide canvas) all showed animals and trees correctly grounded. Forest has no `HORIZON_FRAC`, no ground-anchored cutouts, and no per-photo anchor math at all — just a Ken Burns pan/zoom, a moon, and fireflies placed in plain screen-space fractions — so it's structurally immune to this whole bug class, not just currently bug-free.
- **Closed by removal (2026-08-18, superseding an earlier same-day "Resolved" note that turned out to be premature)**: Beach's `palm-overhang` (the corner-hanging frond) went through nine total rounds of the same underlying "tree floating over water" complaint — a missing trunk, a wrong horizon measurement, a missing water treatment, a depth-order bug, a floating trunk stub, a second unremoved trunk remnant (caught by a PR reviewer, not by this repo's own render-and-look pass), an unclamped region-containment gap, a compound-illusion overlap with a shore palm, and finally the actual root cause: the source asset was never a corner-anchored composition at all (a symmetric photo shot from underneath the tree, zero opaque pixels on its own top row or right-edge column). Every fix before the last one was independently real and independently verified — and none of them could have worked, because the premise under all of them was false. See the "Required Method" section above (now nine rounds, seven rubric categories) for the full account, and `art/CREDITS.md`'s `palm-overhang.webp` entry for the asset-level history. Removed the element entirely rather than attempt a fifth re-crop or re-source: `BEACH_CUTOUT_SOURCES`, `drawBeachOverhang`, `BEACH_DEPTH_LAYERS`'s `palm-overhang` entry, the `palmOverhang` scene field, and the shore-palm placement bias that existed only to avoid it are all gone from `game.js`; `art/beach-cutouts/palm-overhang.webp` is deleted. Categories 4, 5, and 7 (off-canvas justification, composition matches anchor role, compound/combinatorial placement) currently have no asset in either Beach or Safari that they apply to as a result — they stay documented for the next time screen-corner/edge anchoring or independently-overlapping elements are attempted, with category 5's edge-opacity check now a mandatory prerequisite before category 4 even applies. Category 6 (region containment) remains live and in effect: the sun/moon clamp against `waterTopY` this round's investigation also added stays in place regardless of the overhang's removal, since it protects a still-shipping element.
- **Test result (2026-08-19): Desert, the Required Method applied proactively as a deliberate single-attempt test, not reactively after a report.** Player request, verbatim, explicitly framed the ask this way: a new scene (a desert with a distant thunder/lightning storm, desert-specific flora/fauna, naturally-connected placement — "cactuses on the ground not in the air") built through this method in one pass, "because this is a test of its effectiveness." Every category above was addressed before the first render, not after: (1) contact — all four cutouts (`saguaro`, `joshua-tree`, `tumbleweed`, `roadrunner`) measured for a real contiguous opaque run at their own bottom edge before being wired in, same technique as the automated contact test; (2) medium legibility — `GROUND_FRAC` (0.88) measured with a full-row brightness scan (a real ~161→191 jump) and a visual reference-line overlay before being written into `DESERT_CONFIG`, specifically to avoid `HORIZON_FRAC.day`'s original mistake (a value accepted because renders "looked plausible," never checked against the actual photo); (3) depth order — `DESERT_DEPTH_LAYERS` (`flora` → `tumbleweed` → `roadrunner`) written as an explicit array from the start, with the tumbleweed's custom rotate/bounce draw pulled into its own named `drawDesertTumbleweed` function specifically so it stays hookable by a depth-order test, the same reason `drawBeachBoat` exists; (4)/(5) the lightning bolt (the one element here with no ground contact at all, by design — a real distant strike is suspended in open sky) was checked against category 5 up front: is being unanchored actually correct for what it's representing, not just convenient. It is — real lightning doesn't touch a photographed foreground from miles away — but the flash still needed its OWN containment rule (confined strictly above the mapped `GROUND_FRAC` line, never over real photographed ground); (6) region containment — the ground-line panY clamp (mirroring `HORIZON_FRAC`'s own) and the lightning band were both swept across three canvas shapes including the exact 3840×1080 ultrawide shape the Beach `WATER_END_FRAC` review catch was found on, before shipping, not after; (7) compound placement — flora sorted by its own `yFrac` within its shared depth slot, so two rooted plants placed close together on screen still paint in the physically-correct order relative to each other, not just relative to the tumbleweed/roadrunner; (8) relative scale plausibility — named per-species ranges with tumbleweed/roadrunner's ceiling kept below saguaro/Joshua-tree's floor (Beach's dolphin/cruise-ship margin technique), AND the same depth-scaling fix Beach's dolphins needed applied to flora from the start (a far plant renders smaller than the same plant would near the camera), both covered by dedicated tests before the first PR rather than a later round. All eight categories have a corresponding automated test in `tests/smoke.spec.js` (structural draw-order hook, geometry sweep, deterministic constant check, brightness measurement) — see that file's "DESERT SCENE" section. One unrelated, pre-existing test fragility surfaced as a side effect, not a Desert defect: `SCENE_LIST` growing from 7 to 8 entries pushed a *different*, fixed-seed rotate-mode test's expected first-appearance wave for `safari` from within its old 60-wave sample window out to wave 112 for that seed (Rotate mode's package order is a genuine random pick each time, not a shuffle-then-cycle — a coupon-collector problem whose expected cost scales with scene count) — fixed by widening that test's sample to 300 waves, a measured-and-margined value, not a guessed one. Recorded here because it's a generalizable lesson for the next scene added to `SCENE_LIST`, not just a Desert-specific note.
- **Follow-up correction (2026-08-19, same day): the Desert storm wasn't stormy enough.** Player report, screenshot: the first version's single bolt shape, on a rare (6-20s) whale-sighting cadence, didn't read as an active thunderstorm -- "the storm needs to be stormy... rolling thunder, lightning flashes in the storm clouds, occasional lightning streaked across the sky and lightning strikes to the ground (again, all in the distance). The player is not in the storm." Root cause: the wrong reference model, not a measurement error -- Beach's whale IS meant to be a rare sighting, but an active storm is a busy, continuous backdrop, and modeling it on the wrong precedent produced a technically-correct-but-wrong-feeling result no amount of re-tuning the SAME single-bolt shape would have fixed. Rebuilt with three distinct real phenomena (`DESERT_CONFIG.LIGHTNING_KIND_WEIGHTS`: `cloud` a diffuse in-cloud glow, `streak` a jagged cloud-to-cloud bolt, `strike` a jagged bolt reaching down to touch the real `GROUND_FRAC` line with a soft impact glow) at a genuinely active cadence (1.5-6.5s gaps, down from 6-20s), thunder's own event gap tightened to match (8-22s, down from 20-48s) -- all still confined to the sky/mountain band per category 6, `strike` being the one deliberate, documented exception that touches `GROUND_FRAC` itself (a real distant strike does visually connect to the terrain it hits). First-pass render of the `cloud`/`strike` kinds measured a real (if small) pixel difference but was visually a non-event against the photo's own already-bright, already-textured cloud cover and sunlit foreground -- caught by an actual rendered screenshot, not the passing pixel-diff number, and fixed by widening/brightening both until they visibly won against that background at production size. Two new tests cover this: one exercises all three kinds end-to-end (would have caught a real bug this round -- an early draft's fork-angle math read `dx`/`dy` from outside the loop scope they were declared in, a plain reference error `node --check` doesn't catch and the single-bolt version's tests never had a code path to exercise), one confirms `strike` is actually reachable across enough trigger cycles (not a dead weight) and stays contained across the same pan/canvas-shape sweep the general ground-containment test uses. Player's own framing, which stands as this section's operating premise going forward: "it would only have been a big undertaking if we didn't build the framework first. That's why we built the framework so they wouldn't be a big undertaking" -- this correction (two draw-mode redesign, two new tests, doc updates) landed same-session, no PR-and-report round trip required.
- **Resolved (2026-08-19)**: Safari, player report/screenshot -- animals rendering on top of trees they should be behind, and trees rendering underneath other trees in a way that reads as physically wrong. Root cause, confirmed by reading the code before touching it: every tree/animal was bottom-anchored at the exact SAME `horizonY` (no depth variance at all -- Safari predates the depth-order category entirely, having shipped before Beach's cruise-ship/palm bug produced it), then drawn as two entirely separate loops, "all trees, then all animals," each loop's internal order coming straight from `Math.random()`-driven array generation -- the same wrong-axis mistake `BEACH_DEPTH_LAYERS`' own history describes, just never caught here because Safari had no depth concept to get wrong yet. Fixed with a full proactive re-audit against all eight categories, not just the two reported symptoms (player's explicit instruction): (1) contact -- unaffected, already covered by the existing cross-scene contact test; (2) medium legibility -- re-verified `HORIZON_FRAC.night` (0.87) against a fresh reference-line overlay on `safari-night.jpg` (it sits exactly at the real tree-line/grass edge; this value was never photometrically measurable the way day's sharp color transition is, per its own comment, so a visual check is the correct verification method here, not a gap); (3) depth order -- both trees and animals now carry a real `yFrac` (0 = at the horizon/farthest, 1 = nearest the camera, same technique as Desert's flora), depth-scaled the same way Beach's dolphins are, and `drawSafariScene` draws them as ONE combined list sorted by that shared `yFrac` every frame -- deliberately NOT a fixed category array like `BEACH_DEPTH_LAYERS`/`DESERT_DEPTH_LAYERS`, since trees and animals don't have Beach's clean sea-vs-land split (a real photo can show an animal grazing behind a near tree or in front of a distant one, in either order) -- the continuous per-element sort IS the model, documented as such directly in `SAFARI_CONFIG`'s own comment; (4) off-canvas justification -- birds/shooting star unaffected, already an established, tested pattern; (5) composition matches anchor role -- unaffected, cutouts are already whole real photos with base/legs visible; (6) region containment -- a real, separate gap closed proactively while in this code: `drawSafariScene`'s `panY` had NO clamp at all (unlike Beach's own, added after a Codex catch), which happened not to matter while everything pinned to one shared line, but would have let the newly-introduced depth band collapse or invert on an extreme pan phase -- fixed with the same clamp margins Beach uses; (7) compound placement -- the yFrac sort handles arbitrary overlaps by construction now, verified both structurally (a deliberately interleaved mix of tree/animal yFracs never draws out of order) and with a literal same-x pin (a near animal and a far tree forced to the same x, animal must draw on top), mirroring Beach's own two-tier test pattern; (8) relative scale plausibility -- named `TREE_SIZE_FRAC`/`ANIMAL_SIZE_FRAC` ranges (previously inline literals) plus the same depth-scaling fix Beach's dolphins/Desert's flora needed, so one element's own roamed position can't read as implausible even without overlapping another. Five new tests cover categories 3, 6, 7 (×2), and 8 directly, plus the existing "generates and draws without error" test continues covering the basics. Verified visually across day/night variants, four pan phases, and an ultrawide (3840×1080) canvas before shipping -- see `tests/smoke.spec.js`'s Safari section and `art/CREDITS.md`'s own note on this pass.
