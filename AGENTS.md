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

**Standing authorization for the normal ship loop**: the player (klefner) has explicitly said not to
stop and wait for a go-ahead on the routine steps that make up shipping a change here — merging a PR once
CI is green and review threads are resolved, pushing the resulting deploy, watching it land on GitHub
Pages/Cloudflare Pages/itch.io. Treat that authorization as already granted for this repo's normal loop;
don't pause mid-task to ask permission for it. This does NOT cover genuinely destructive or irreversible
actions outside that normal loop (force-pushing over someone else's work, deleting a branch with unmerged
commits, rewriting shipped history) — those still warrant checking in, same as any repo.

**Binding, not optional: SOURCE_OF_TRUTH.md's "Required Method: Grounding a Cutout on a Real-Photo
Scene."** This isn't reference material to skim — it's a mandatory checklist-plus-tests that MUST be
applied every time a scene composites a foreground cutout onto a real photo background, in this repo or
any future one built the same way. It exists because prose review alone produced the same "floating tree"
class of bug nine separate times on Beach before the method reached its current form. Any new photo-scene
work (a new cutout, a new scene, a changed `sizeFrac` range or anchor formula) needs its own pass through
all eight rubric categories there, with automated test coverage added for whichever ones are testable —
not a one-time visual check that gets skipped under time pressure. If a category surfaces a bug this
method didn't already have a check for, the fix isn't done until the method itself is updated with a new
category, the same way rounds 6–9 of Beach's history did.
