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
optional overhead — it exists because prose review alone failed on the exact
same scene *five separate times* (PRs #101–#104, plus a fifth round caught
directly in review before a PR was even opened) before this method existed in
its current, test-backed form:

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

Round 5 is the reason this section stopped being a checklist you run once by
eye and became a set of things you write **actual automated tests** for. A
human (or an AI) reviewing a screenshot reliably stops looking once it has
found *one* plausible explanation for what's wrong — confirmed directly in
this repo's own history, twice in the same conversation. A checklist you
apply by eye has the same failure mode as the code it's reviewing: it's only
as exhaustive as your attention was that day. An enforced test suite doesn't
get tired, doesn't stop at the first hit, and reruns identically on every PR.

**The four rubric categories, and how each one is actually enforced:**

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
   (`drawBeachCutout`/`drawBeachBoat`/`drawBeachOverhang` — no more raw
   `ctx.fill()` calls inlined directly in the scene function, precisely
   because that can't be hooked), then assert in a test that the actual
   sequence of layers drawn in a real frame never goes backwards through
   that model. Backed by a second, narrower regression test that forces two
   elements to the exact same x — don't rely on random sampling to
   *happen* to hit the collision case; force it. **Any new scene with more
   than one foreground layer needs its own depth model constant and this
   same pair of tests**, not just Beach's.
4. **Off-canvas justification** (only for cutouts deliberately cropped
   mid-asset on the assumption "it continues off-frame," like the overhang
   frond) — does the cutoff point actually land at/near a real canvas edge
   across the cutout's whole production size range, not just the range it
   was designed at originally? **This is the one category without a full
   automated check yet** (the geometry depends on where in the source image
   the deliberate cut point falls, which isn't recorded anywhere) — it
   still requires rendering the element at its current size/position
   extremes and looking at a crop of just that element. Known open instance:
   the Beach overhang frond's trunk currently fails this check (see Known
   Open Risk Areas below) — do not consider it fixed until a render-and-look
   pass confirms otherwise, and prefer building a real automated check for
   this category (e.g. recording the cut point's fractional position when
   an asset is first processed, then asserting it stays within some margin
   of an edge across the size range) over leaving it manual-only long-term.

**Whenever any of the above changes** (a new cutout, a new scene, a changed
`sizeFrac` range, a changed anchor formula), re-run the relevant tests AND
re-verify anything in category 4 by eye — a passing test suite from before
the change is not evidence about the change itself. Two things must hold
before considering photo-composited work in this repo done: `npm test`
passes, AND every category-4 element for anything touched has been rendered
and looked at since the change, not just reasoned about.

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
- **Open, unfixed**: Beach's `palm-overhang` (the corner-hanging frond) fails the Required Method's category-4 check (off-canvas justification) — its trunk visibly terminates in open air well inside the frame rather than near/at a screen edge, the same underlying failure as round 2 above wearing a different asset. Introduced when `overhang.sizeFrac` was shrunk (0.55–0.70 → 0.28–0.36) to fix an unrelated "too large, blocks dots" complaint; nobody re-verified the "trunk exits the frame" justification still held at the smaller size (player report, screenshot, 2026-08-18). Category 4 has no automated check yet (see the Required Method entry for why) — fix by rendering the overhang at its current production size range and confirming by eye, most likely via a tighter source crop that removes the dangling trunk segment rather than trying to re-inflate the size back into "blocks dots" territory.
