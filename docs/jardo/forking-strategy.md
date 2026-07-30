# Forking strategy

How this fork (`Jardo-51/t3code`) tracks upstream (`pingdotgg/t3code`) while carrying its own
features and bugfixes, and how those changes get contributed back.

This document is fork-local. It lives under `docs/jardo/` so it is purely additive — upstream has no
file at this path, so it never causes a merge conflict.

## Branches

| Branch | Role | Rules |
| --- | --- | --- |
| `main` | Mirror of `upstream/main`. No custom work, ever. | Fast-forward only. Never commit here. |
| `custom/main` | The fork's real trunk: upstream plus all custom changes. | Default branch on `origin`. Never force-pushed. |
| `feature/*` | Upstreamable work. Branched from `main`. | Must not depend on custom code. |
| `custom/*` | Fork-only work. Branched from `custom/main`. | Free to depend on other custom changes. |

The two classes of feature branch matter. A branch cut from `main` cannot reference anything custom —
if it does, it will not build for upstream. A branch that needs existing customizations must be cut
from `custom/main` and can only ever be merged there.

If a `custom/*` branch later turns out to be upstreamable, cherry-pick it onto a fresh `feature/*`
branch off `main` rather than retargeting it.

Note: branch names like `custom/foo` coexist fine with `custom/main`, but a branch named plain
`custom` can never exist alongside them.

## One-time setup

```bash
git remote add upstream git@github.com:pingdotgg/t3code.git
git remote set-url --push upstream DISABLED   # guard against pushing to upstream by accident
git config rerere.enabled true                # replay conflict resolutions across repeated merges
```

`rerere` matters here: syncing upstream into `custom/main` tends to surface the same conflicts
repeatedly, and recorded resolutions get replayed automatically.

## Syncing `main` with upstream

```bash
git fetch upstream
git switch main
git merge --ff-only upstream/main
git push origin main
```

If `--ff-only` fails, something was committed to `main`. That is the signal to investigate, not to
reach for a regular merge.

## Syncing upstream into `custom/main`

Merge, do not rebase:

```bash
git switch custom/main
git merge main
git push origin custom/main
```

Rebasing would give a cleaner "my patches on top of upstream" series, but it requires force-pushing
the branch that releases are built from and breaks every other clone and worktree. Merging keeps the
history honest at the cost of noise. The custom delta is still readable on demand:

```bash
git log --oneline --no-merges main..custom/main
```

## Starting a feature

Sync first, so the branch is based on current upstream:

```bash
git fetch upstream
git switch main && git merge --ff-only upstream/main && git push origin main
git switch -c feature/my-change
```

Shortcut when the mirror branch does not need updating right now:

```bash
git fetch upstream
git switch -c feature/my-change upstream/main
```

What actually matters is being current when the PR is *opened*, not when the branch is created. If a
branch has gone stale, rebase it rather than merging upstream into it:

```bash
git fetch upstream && git rebase upstream/main
```

Force-pushing a `feature/*` branch is fine — it only lives in this fork. Be more careful once
upstream reviewers have left inline comments, since a rebase can detach them from their lines.

## Opening pull requests

**Into the fork:** `feature/*` or `custom/*` → `custom/main` on `Jardo-51/t3code`.

**Into upstream:** `feature/*` → `main` on `pingdotgg/t3code`.

The fork's default branch is `custom/main`, which is what we want for everyday use, but it means
GitHub's cross-fork compare preselects `custom/main` as the head branch. Always switch it to the
feature branch before submitting, or the entire fork gets proposed to upstream.

## The round-trip duplicate problem

Upstream squash-merges — its history is one commit per PR (`fix(web): … (#4853)`). So when a feature
goes to both places:

1. `feature/x` merges into `custom/main` → its original commits become ancestors of `custom/main`.
2. Upstream squashes `feature/x` into **one new commit with a different SHA**.
3. The next upstream sync brings in a commit that git cannot tell is equivalent → conflicts on every
   hunk of that feature.

Mitigations, in order of value:

- **Wait for upstream to merge before merging into `custom/main`**, when the delay is tolerable. The
  change then arrives for free through the normal sync with nothing to reconcile.
- If it is needed sooner, resolve the eventual conflict toward upstream's version and let `rerere`
  remember the resolution.

To tell duplicated commits from genuinely custom ones, `=` marks equivalent, `>` marks fork-only:

```bash
git log --cherry-mark --left-right --no-merges main...custom/main
```

## Keeping the merge tax low

- **Do not touch version fields.** A release commit touches `apps/desktop/package.json`,
  `apps/server/package.json`, `apps/web/package.json`, and `packages/contracts/package.json`. Editing
  those in custom commits creates a conflict on every single upstream release. If custom builds need
  their own identity, inject it at build time or use a separate marker file upstream does not have.
- **Prefer additive files over edits to shared code.** Every line changed in a file upstream also
  touches is a recurring cost. Small hook-points beat changes scattered through common modules.
- **Keep upstreamable work separate from fork-only work** from the first commit. Untangling them
  later is far more expensive than deciding the branch base up front.
