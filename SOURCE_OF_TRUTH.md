# Lumina Source of Truth

Instantiated from [studio-ops/templates/SOURCE_OF_TRUTH_TEMPLATE.md](https://github.com/klefner/studio-ops/blob/main/templates/SOURCE_OF_TRUTH_TEMPLATE.md).
See [studio-ops/AGENTS.md](https://github.com/klefner/studio-ops/blob/main/AGENTS.md) for the shared rules
this file exists to support.

## Current State As Of 2026-07-23

| Layer | Current value | Meaning |
| --- | --- | --- |
| Canonical repo | `klefner/lumina` on GitHub | No local-only or OneDrive-style checkout involved — GitHub is the whole story for this repo. |
| Active development branch | `claude/lumina-game-build-dupma4` (or a fresh branch cut from current `main` for each unit of work) | Feature/fix work lands here, then merges to `main` via PR. |
| Is `main` current? | Yes | Every merged PR this project has shipped went through squash-merge into `main`; `main` is always the real state. |
| Current build/version label | Short commit hash of the latest squash-merge commit on `main` | e.g. `932d6f1` |
| Live deploy URL | `https://klefner.github.io/lumina/` | |
| Live deploy verification method | `curl https://klefner.github.io/lumina/version.json` and compare the `build` field to the latest commit hash on `main` | GitHub Pages deploys straight from `main` on every push; this is a direct, mechanical check anyone (human or AI) can run themselves. |
| Deploy source (branch / folder) | `main`, repo root (GitHub Pages default) | No separate release-package step, no separate deploy branch — what's on `main` is what's live, once Pages finishes building. |

## Non-Negotiable Distinctions

- A commit existing on a feature branch is not the same as it being on `main`.
- `main` being current is not the same as GitHub Pages having finished deploying it yet — always verify via `version.json`, not by assuming the push landed instantly.
- After a squash-merge, a local feature branch's pre-squash commits diverge from the new squashed commit on `main` (same content, different hash). Re-sync with `git fetch origin main --force && git checkout -B <branch> origin/main` before starting new work, rather than trying to rebase or reuse the old branch history.

## Known Open Risk Areas

- The audio "no sound" fix (sample-loading race + AudioContext resume hardening, shipped in PR #18) is verified by automated tests but not yet confirmed against a real device that's had an actual interruption (phone call, notification) mid-session — see the Beta Group 2 readiness checklist for the full context.
- The wide-playfield/zoom-out onboarding mechanic (PR #20) is covered by Playwright but not yet confirmed on a real touch device's pinch-zoom/pan gestures.
