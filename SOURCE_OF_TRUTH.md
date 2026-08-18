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
line," "water line," etc. derived as some fraction of the photo/canvas) MUST
go through the four checks below before shipping. This repo shipped the same
underlying mistake four separate times on the Beach scene's night variant
(PRs #101–#104) before this method existed — each fix looked complete in
isolation, and each one still let a variant of "things floating where they
shouldn't be" reach a real player screenshot. In order, what actually went
wrong each time, mapped to the check that would have caught it:

1. Shore palms anchored at `horizonY` (the water/sky line) with nothing drawn
   under them — read as trees floating in the air, over the water.
2. `horizonY` anchor was correct in principle, but the crown-only cutout had
   no trunk of its own reaching that anchor point — still read as floating,
   just closer to the ground.
3. `HORIZON_FRAC.night` itself was flat wrong (0.672 instead of 0.903) — a
   single-column brightness-gradient scan locked onto a bright star instead
   of the real, much subtler, sky-to-sand transition. Every horizon-anchored
   cutout (the ship, the dolphins) was floating in the middle of the
   starfield as a direct result.
4. Even after fixing the measurement, the region between the (now correct)
   horizon and the sand was real photographed SAND, not water — the ship and
   dolphins were anchored at the right *fraction*, sitting on nothing,
   because the photo itself shows no distinguishable water surface at night
   (open water in near-total darkness looks identical to the sky above it).

**The method, to run for every anchor point in every photo-composited scene:**

1. **Verify the measurement against the actual photo, visually, before
   trusting it.** Don't ship an automated heuristic's output (a brightness-
   gradient scan, an edge detector) unchecked — crop the source photo at the
   exact measured row/fraction and look at it. A single-column scan is
   especially unreliable on any photo with small high-contrast features
   (stars, birds, textured foliage) along that one column; prefer a full-row
   brightness AVERAGE, which only fires on a transition consistent across
   the entire row's width, not a single outlier pixel.
2. **Confirm the cutout asset itself makes contact with the anchor point.**
   A crown without a trunk, a hull without a waterline, an animal cropped
   above its feet — anything that doesn't visually terminate AT the surface
   it's meant to be anchored to will read as floating no matter how correct
   the anchor math is. Either source/build a cutout that includes the
   contact point, or add a rendered element (a procedural trunk, a stem)
   that visually bridges the gap — and confirm the seam looks like contact,
   not just that the numbers line up.
3. **Confirm the surrounding medium is visually distinguishable at the
   anchor point, in the actual rendered frame.** "The math places this dot
   at the correct fraction of the photo" is not the same claim as "a human
   looking at this composited frame would identify this region as water /
   sand / grass." A night photo in particular can have a real horizon that
   is nonetheless visually identical to the sky above it. If the photo
   doesn't make the medium legible on its own, add a deliberate treatment
   (a tinted gradient, a texture) rather than relying on an unaided dark
   photo to read correctly.
4. **Render the actual composited scene and inspect a crop at each anchor
   point** — not just eyeball the whole screenshot once. Do this across the
   realistic range of variation the element will hit in production: several
   random positions (if placement is randomized), several points in the
   pan/zoom cycle (early/mid/late, not just frame 0), and both a narrow
   portrait canvas and a wide landscape one. A fix that only gets checked at
   one lucky phase/canvas-shape is how #101's Codex-caught wide-canvas bug
   and this whole four-round Beach saga both slipped through in the first
   place.

Safari and Forest use the same `HORIZON_FRAC`-anchored architecture as Beach
(`SAFARI_CONFIG.HORIZON_FRAC`/`drawSafariScene`, same brightness-gradient
measurement technique). They were audited against this method on 2026-08-17
when it was written (see the dated entry under Known Open Risk Areas below
for the result) — re-run this method again for either scene if their source
photos, `HORIZON_FRAC` values, or cutout library ever change.

## Known Open Risk Areas

- The audio "no sound" fix (sample-loading race + AudioContext resume hardening, shipped in PR #18) is verified by automated tests but not yet confirmed against a real device that's had an actual interruption (phone call, notification) mid-session — see the Beta Group 2 readiness checklist for the full context.
- The wide-playfield/zoom-out onboarding mechanic (PR #20) is covered by Playwright but not yet confirmed on a real touch device's pinch-zoom/pan gestures.
- One-off incident: the PR #42 merge deploy (2026-07-31) hit a transient Cloudflare API 522 on the "Deploy to Cloudflare Pages" step while the GitHub Pages step in the same job succeeded, leaving `lumina-8f0.pages.dev` briefly stale relative to `klefner.github.io/lumina/`. Resolved with a fresh push to `main` to re-run the whole job (neither `rerun_workflow_run` nor `workflow_dispatch` were available to the token used, 403). Single occurrence so far — not worth permanent dual-host verification unless it recurs. See the Non-Negotiable Distinctions entry above for why that same 403 shaped the 2026-08-16 itch.io auto-deploy revert.
- 2026-08-17 audit result (see "Required Method: Grounding a Cutout on a Real-Photo Scene" above, the method this audit was run under): Safari and Forest were both checked against all four steps and found clean, no fix needed. Safari — both `HORIZON_FRAC` values (`{ day: 0.80, night: 0.87 }`) visually confirmed against actual crops of `safari-day.jpg`/`safari-night.jpg`; all five cutouts (`tree-acacia`, `tree-baobab`, `animal-zebra`, `animal-giraffe`, `animal-elephant`) include their own full base/legs down to the ground, no crown-only or feet-cropped assets; `safari-night.jpg` (unlike `beach-night.jpg`) shows a real lit, visible ground plane at its horizon, not near-total darkness, so no synthetic medium treatment is needed there; six renders (day/night × early/mid pan phase × portrait/wide canvas) all showed animals and trees correctly grounded. Forest has no `HORIZON_FRAC`, no ground-anchored cutouts, and no per-photo anchor math at all — just a Ken Burns pan/zoom, a moon, and fireflies placed in plain screen-space fractions — so it's structurally immune to this whole bug class, not just currently bug-free.
