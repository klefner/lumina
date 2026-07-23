# Agent Operating Contract — Lumina

This repo follows the shared studio operating model at
[github.com/klefner/studio-ops](https://github.com/klefner/studio-ops). Read that repo's `AGENTS.md` first —
it covers the rules that hold the same way across every game repo in this studio (know what's actually
live, don't work directly on `main`, keep local/branch/live state distinct, and so on).

Then read this repo's own [`SOURCE_OF_TRUTH.md`](./SOURCE_OF_TRUTH.md) for Lumina's specific facts —
canonical repo, active branch, current build label, and how to actually verify what's live.

Lumina intentionally runs a lighter process than some other repos in this studio (no local-only governed
checkout, no separate release-package step, no per-build numbering scheme) — GitHub is the whole story
here: feature branch → CI (Playwright smoke tests) → PR review → squash-merge to `main` → GitHub Pages
auto-deploys `main`. Keep it that light unless a real, recurring problem shows up that calls for more.
