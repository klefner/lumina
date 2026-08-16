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

## Known Open Risk Areas

- The audio "no sound" fix (sample-loading race + AudioContext resume hardening, shipped in PR #18) is verified by automated tests but not yet confirmed against a real device that's had an actual interruption (phone call, notification) mid-session — see the Beta Group 2 readiness checklist for the full context.
- The wide-playfield/zoom-out onboarding mechanic (PR #20) is covered by Playwright but not yet confirmed on a real touch device's pinch-zoom/pan gestures.
- One-off incident: the PR #42 merge deploy (2026-07-31) hit a transient Cloudflare API 522 on the "Deploy to Cloudflare Pages" step while the GitHub Pages step in the same job succeeded, leaving `lumina-8f0.pages.dev` briefly stale relative to `klefner.github.io/lumina/`. Resolved with a fresh push to `main` to re-run the whole job (neither `rerun_workflow_run` nor `workflow_dispatch` were available to the token used, 403). Single occurrence so far — not worth permanent dual-host verification unless it recurs. See the Non-Negotiable Distinctions entry above for why that same 403 shaped the 2026-08-16 itch.io auto-deploy revert.
