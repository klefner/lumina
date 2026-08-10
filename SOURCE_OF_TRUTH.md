# Lumina Source of Truth

Instantiated from [studio-ops/templates/SOURCE_OF_TRUTH_TEMPLATE.md](https://github.com/klefner/studio-ops/blob/main/templates/SOURCE_OF_TRUTH_TEMPLATE.md).
See [studio-ops/AGENTS.md](https://github.com/klefner/studio-ops/blob/main/AGENTS.md) for the shared rules
this file exists to support.

## Current State As Of 2026-07-31

| Layer | Current value | Meaning |
| --- | --- | --- |
| Canonical repo | `klefner/lumina` on GitHub | No local-only or OneDrive-style checkout involved — GitHub is the whole story for this repo. |
| Active development branch | `claude/lumina-game-build-dupma4` (or a fresh branch cut from current `main` for each unit of work) | Feature/fix work lands here, then merges to `main` via PR. |
| Is `main` current? | Yes | Every merged PR this project has shipped went through squash-merge into `main`; `main` is always the real state. |
| Current build/version label | Short commit hash of the latest squash-merge commit on `main` | e.g. `932d6f1` |
| Live deploy URL (canonical) | `https://lumina-8f0.pages.dev/` | Cloudflare Pages — the primary deploy target and the one to check for build-freshness (see verification method below). No personal name in it, unlike the GitHub Pages URL below. No longer the link promoted to players — see "Promoted share URL". |
| Live deploy URL (secondary mirror) | `https://klefner.github.io/lumina/` | GitHub Pages. Kept running alongside Cloudflare Pages as a free fallback — useful if Cloudflare ever has an outage. |
| Promoted share URL | `https://draclif.itch.io/lumina` | The itch.io storefront page — the link actually baked into the in-game postcard/share text (see `CANONICAL_SHARE_URL` in `game.js`) and the one to hand someone (Reddit/X/etc). **Not** pushed automatically on merge to `main` (as of PR #78) — pushed only by manually running `.github/workflows/deploy-itch.yml` (Actions tab → "Deploy to itch.io" → Run workflow), after a build has been tested live on the two hosts above and approved. Until that workflow is run for a given build, this URL can be behind the two hosts above; check its own `version.json` rather than assuming it tracks `main`. |
| Live deploy verification method | `curl https://lumina-8f0.pages.dev/version.json` (or the github.io URL for the mirror) and compare the `build` field to the latest commit hash on `main` | Both hosts deploy straight from `main` on every push; this is a direct, mechanical check anyone (human or AI) can run themselves. |
| Deploy source (branch / folder) | `main`, staged into `_site` by the "Stage site files" step in `.github/workflows/deploy-pages.yml`, then pushed to **both** GitHub Pages and Cloudflare Pages (project name `lumina`) from that same job | Not the whole repo root — that step copies an explicit allowlist (`index.html`, `game.js`, `style.css`, `manifest.json`, `version.json`, `icons/`, `sounds/`) into `_site`, and only `_site` gets deployed. A file being on `main` is **not** enough on its own to make it live — check the copy list. The Cloudflare Pages deploy step is gated to `github.ref == 'refs/heads/main'` so a manual `workflow_dispatch` from any other branch can never overwrite production (see PR #28). |

## Non-Negotiable Distinctions

- A commit existing on a feature branch is not the same as it being on `main`.
- A file being on `main` is not the same as it being in the deployed site — only what `deploy-pages.yml`'s "Stage site files" step explicitly copies into `_site` ships. Adding a new player-facing file (a new asset, a new split-out JS module) to `main` without also adding it to that copy list will silently never go live. This file (`SOURCE_OF_TRUTH.md`) and `AGENTS.md` are deliberately **not** on that list — they're developer/agent docs, not meant to be served to players.
- `main` being current is not the same as GitHub Pages having finished deploying it yet — always verify via `version.json`, not by assuming the push landed instantly.
- After a squash-merge, a local feature branch's pre-squash commits diverge from the new squashed commit on `main` (same content, different hash). Re-sync with `git fetch origin main --force && git checkout -B <branch> origin/main` before starting new work, rather than trying to rebase or reuse the old branch history.

## Known Open Risk Areas

- The audio "no sound" fix (sample-loading race + AudioContext resume hardening, shipped in PR #18) is verified by automated tests but not yet confirmed against a real device that's had an actual interruption (phone call, notification) mid-session — see the Beta Group 2 readiness checklist for the full context.
- The wide-playfield/zoom-out onboarding mechanic (PR #20) is covered by Playwright but not yet confirmed on a real touch device's pinch-zoom/pan gestures.
- One-off incident: the PR #42 merge deploy (2026-07-31) hit a transient Cloudflare API 522 on the "Deploy to Cloudflare Pages" step while the GitHub Pages step in the same job succeeded, leaving `lumina-8f0.pages.dev` briefly stale relative to `klefner.github.io/lumina/`. Resolved with a fresh push to `main` to re-run the whole job (neither `rerun_workflow_run` nor `workflow_dispatch` were available to the token used, 403). Single occurrence so far — not worth permanent dual-host verification unless it recurs.
