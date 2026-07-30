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
| `custom/upstream-pr-*` | Unmerged upstream PRs adopted early. Branched from `custom/main`. | Third-party code — read the diff first. |

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
3. The next upstream sync brings in a commit git cannot recognise as equivalent.

Step 3 is less alarming than it sounds. Where both sides made the *same* change relative to the merge
base, git merges cleanly with no conflict at all — so a PR upstream took as-is costs nothing. Conflict
size tracks how much review changed the PR, not how big the PR was.

Mitigations, in order of value:

- **Wait for upstream to merge before merging into `custom/main`**, when the delay is tolerable. The
  change then arrives for free through the normal sync with nothing to reconcile.
- If it is needed sooner, resolve the eventual conflict toward upstream's version and let `rerere`
  remember the resolution.

To tell duplicated commits from genuinely custom ones, `=` marks equivalent, `>` marks fork-only:

```bash
git log --cherry-mark --left-right --no-merges main...custom/main
```

## Adopting unmerged upstream PRs

Sometimes an open PR on `pingdotgg/t3code` — often from a third-party fork — has a fix worth having
before upstream merges it. Adopt it into `custom/main` and then treat it like any other custom
change: **never revert it**, and when upstream eventually lands its own version, resolve the merge
conflict.

That is the whole policy. There is no manifest to keep accurate, no pre-sync audit of PR states, and
no ordering discipline. Syncing stays `git merge main`.

### Fetching the PR

GitHub exposes every PR head on the upstream repo itself, so the contributor's fork never needs to be
a remote. These refs survive even if the author deletes their fork.

```bash
gh pr diff 5013 --repo pingdotgg/t3code          # read it first — see the caution below
git fetch upstream pull/5013/head:vendor/pr-5013
```

Do **not** configure the blanket refspec (`+refs/pull/*/head:…`) that gets suggested for this. On a
repo this active it drags in thousands of refs and every abandoned PR's objects. Fetch PRs one at a
time.

Never hand-copy a diff instead of fetching it. Copying silently drops renames, deletions, mode
changes, and binary files, there is no way to verify the result, and re-syncing when the author
pushes an update becomes manual work.

### Adopting it

Branch from `custom/main` so the change lands in the context of the fork's own code and any conflicts
surface here rather than later:

```bash
git switch -c custom/upstream-pr-5013-local-bin-path custom/main
git cherry-pick "$(git merge-base main vendor/pr-5013)..vendor/pr-5013"
```

Merge with `--no-ff` and put the PR number in the subject:

```bash
git switch custom/main
git merge --no-ff custom/upstream-pr-5013-local-bin-path \
  -m "vendor: adopt upstream PR #5013 (server: ~/.local/bin on boot service PATH)"
```

The PR number in the subject is not bookkeeping — it is archaeology. When a conflict appears in that
code six weeks later, `git log --grep='PR #5013'` explains instantly why the code is contested and
points at the upstream PR to see how it changed.

### When upstream merges its version

Nothing special happens. Sync normally:

```bash
git merge main
```

If upstream took the PR as-is, the merge is clean. If review changed it, the conflict is proportional
to that divergence — resolve it **toward upstream's version wholesale**, since theirs is canonical
from that point on:

```bash
git checkout --theirs path/to/file    # mid-merge, "theirs" is the main side
```

Then re-apply any local adaptations as a separate commit. Blending hunk by hunk is where duplication
bugs come from.

If upstream closes the PR without merging and the change is still wanted, nothing needs doing — it is
simply part of the fork now, maintained like any other custom change.

### The one real hazard

A textual merge can succeed while producing **semantic duplication**: the PR adds a registration, a
switch arm, a provider entry, or a migration, and upstream's merged version adds an equivalent one a
few lines away. Git sees two non-overlapping insertions, keeps both, exits clean — and the thing is
now registered twice.

So the discipline this approach needs is not bookkeeping but a post-merge check. After any sync that
touched adopted code: build, run the tests, and grep for identifiers the PR introduced.

### Notes

- **Depending on adopted code is fine.** Because nothing is ever reverted, a custom feature may build
  on an adopted PR freely. This is the main reason the no-revert policy is worth its occasional
  conflicts.
- **Reverting is still available as an optimisation.** If an adopted PR is self-contained and upstream
  is known to have merged it, `git revert -m 1 <merge-sha>` before syncing is the cheaper path.
  Nothing breaks when this is skipped, which is the point.
- **Never merge a `custom/upstream-pr-*` branch into a `feature/*` branch.** That would propose
  someone else's unmerged work to upstream as our own.
- **Adopted code is unreviewed and runs with shell access.** T3 Code is an agent with access to the
  machine. Read the diff before merging, not after.
- **Keep an escape hatch for ugly syncs.** Note the pre-merge SHA, or trial the merge on a scratch
  branch and throw it away if the result looks wrong:

  ```bash
  git switch -c sync-trial custom/main && git merge main
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
