# Forking strategy

How this fork (`Jardo-51/t3code`) tracks upstream (`pingdotgg/t3code`) while carrying its own
features and bugfixes, and how those changes get contributed back.

This document is fork-local. It lives under `docs/jardo/` so it is purely additive — upstream has no
file at this path, so it never causes a merge conflict.

## Branches

| Branch                 | Role                                                                    | Rules                                                                                |
| ---------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `main`                 | Mirror of `upstream/main`. No custom work, ever.                        | Fast-forward only. Never commit here.                                                |
| `custom/main`          | The fork's real trunk: upstream plus all custom changes.                | Default branch on `origin`. Never force-pushed.                                      |
| `custom/feature/*`     | Where all new work starts. Branched from `custom/main`.                 | Merged into `custom/main` only.                                                      |
| `custom/*`             | Other fork-only work. Branched from `custom/main`.                      | Free to depend on other custom changes.                                              |
| `custom/upstream-pr-*` | Unmerged upstream PRs adopted early. Branched from `custom/main`.       | Third-party code — read the diff first.                                              |
| `feature/*`            | A promotion branch: one `custom/feature/*` change replayed onto `main`. | Created at PR time. Must not depend on custom code. Never merged into `custom/main`. |
| `vendor/pr-*`          | Raw upstream PR heads, fetched verbatim.                                | Never merged directly; only cherry-picked from.                                      |

**All work starts on `custom/feature/*`, cut from `custom/main` — including work intended for
upstream.** A `feature/*` branch is not where you develop; it is a branch created later, at the
moment you open the upstream PR, holding the same change replayed onto `main`.

The reason is that `feature/*` branches sit on a different base. Merging one into `custom/main` would
also drag in every upstream commit between `custom/main`'s current base and that branch's tip — an
unplanned partial upstream sync at an arbitrary point, skipping the deliberate merge in
[Syncing upstream into `custom/main`](#syncing-upstream-into-custommain). So `feature/*` branches
flow to upstream and nowhere else, and the fork's trunk only ever receives upstream through one door.

This defers a decision rather than removing it. A change that reaches into custom code still cannot
be upstreamed, and the branch base no longer forces you to notice on day one — you find out when the
cherry-pick onto `main` fails to build. When you already know a change is upstreamable, keep it free
of custom dependencies from the first commit; the promotion is then mechanical.

Note: nested names like `custom/foo` and `custom/feature/bar` coexist fine with `custom/main`, but a
branch named plain `custom` — or plain `custom/feature` — can never exist alongside them, since git
stores refs as paths and a file cannot also be a directory.

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

Use `git merge --ff-only <SHA>` if you want a specific commit (released version) rather than the upstream HEAD.

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

Always from `custom/main`, whatever the change is for:

```bash
git switch custom/main
git pull --ff-only origin custom/main   # other clones' work, not upstream
git switch -c custom/feature/my-change
```

No upstream fetch is involved. Whether `custom/main` is current with upstream does not affect this
branch — it only affects when the fork pays for the next upstream sync, which is the same cost
whenever it happens. Merge it back the normal way:

```bash
git switch custom/main
git merge --no-ff custom/feature/my-change
```

For anything headed upstream, collapse it to a single commit instead:

```bash
git merge --squash custom/feature/my-change && git commit
```

That keeps the fork's commit patch-identical to the one commit upstream will squash the PR into,
which is what lets `--cherry-mark` recognise the round trip later. For fork-only work the merge
commit is more useful, so `--no-ff` stays the default.

## Promoting a feature upstream

Do this when the PR is ready to open, not before. The promotion branch is cut from a freshly synced
`main` and holds the same change replayed onto it:

```bash
git fetch upstream
git switch main && git merge --ff-only upstream/main && git push origin main
git switch -c feature/my-change main
git cherry-pick -x custom/main..custom/feature/my-change
```

That range is exactly the feature's own commits, since the branch was cut from `custom/main`. It
works whether or not the feature has been merged into the trunk yet — if it has, use the squashed
merge commit or the pre-merge branch tip instead.

Then build and test it _there_. This is the point where a hidden dependency on custom code shows up,
and it is cheaper to find now than in upstream's review.

What matters is being current when the PR is _opened_, not when the branch was created. If the branch
goes stale while under review, rebase it rather than merging upstream into it:

```bash
git fetch upstream && git rebase upstream/main
```

Force-pushing a `feature/*` branch is fine — nothing in the fork builds on it. Be more careful once
upstream reviewers have left inline comments, since a rebase can detach them from their lines.

If review changes the PR, do not merge `feature/*` back into `custom/main` to collect the
improvements — that would drag upstream's commits in with them. Let the change return through the
normal sync, or cherry-pick the individual review commits onto a fresh `custom/feature/*` branch.

## Opening pull requests

**Into the fork:** `custom/*` (including `custom/feature/*`) → `custom/main` on `Jardo-51/t3code`.
Never `feature/*`.

**Into upstream:** `feature/*` → `main` on `pingdotgg/t3code`.

The fork's default branch is `custom/main`, which is what we want for everyday use, but it means
GitHub's cross-fork compare preselects `custom/main` as the head branch. Always switch it to the
feature branch before submitting, or the entire fork gets proposed to upstream.

## The round-trip duplicate problem

Upstream squash-merges — since 2026-02-28 its history is one commit per PR (`fix(web): … (#4853)`).
Only the repo's first three weeks contain real merge commits, so treat "one commit per PR" as true of
everything the fork will ever sync. So when a feature goes to both places:

1. `custom/feature/x` merges into `custom/main` → its commits become ancestors of `custom/main`.
2. The promotion branch `feature/x` carries the same change upstream, which squashes it into **one new
   commit with a different SHA**.
3. The next upstream sync brings in a commit git cannot recognise as equivalent.

Step 3 is less alarming than it sounds. Where both sides made the _same_ change relative to the merge
base, git merges cleanly with no conflict at all — so a PR upstream took as-is costs nothing. Conflict
size tracks how much review changed the PR, not how big the PR was.

Mitigations, in order of value:

- **Wait for upstream to merge before merging into `custom/main`**, when the delay is tolerable. Leave
  the work sitting on its `custom/feature/*` branch, promote it, and if upstream takes it the change
  arrives for free through the normal sync with nothing to reconcile — the fork-side branch is then
  thrown away unmerged. Promotion only needs the `custom/feature/*` branch, not a merge into the
  trunk.
- If it is needed sooner, resolve the eventual conflict toward upstream's version and let `rerere`
  remember the resolution.

To tell duplicated commits from genuinely custom ones, `=` marks equivalent, `>` marks fork-only:

```bash
git log --cherry-mark --left-right --no-merges main...custom/main
```

This only detects the single-commit case. Equivalence is decided by patch-id, so a fork-side feature
that landed as three commits will never match upstream's one squashed commit — both sides show as
unique and the duplicate goes unreported. Squashing `custom/feature/*` when merging it into
`custom/main` keeps the patch-ids comparable and is the cheap way to make this command mean something.

## Adopting unmerged upstream PRs

Sometimes an open PR on `pingdotgg/t3code` — often from a third-party fork — has a fix worth having
before upstream merges it. Adopt it into `custom/main` and then treat it like any other custom
change: **do not revert it to make a future sync easier**, and when upstream eventually lands its own
version, resolve the merge conflict. One narrow exception is noted at the end of this section; it is
an optimisation, never a requirement.

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
git cherry-pick -x --no-merges "$(git merge-base main vendor/pr-5013)..vendor/pr-5013"
```

Both flags earn their place. `--no-merges` is not optional: a PR that has been open a while usually
has upstream merged into it, and without the flag the cherry-pick applies a few commits, then aborts
on the first merge commit (`is a merge but no -m option was given`) leaving a half-applied sequencer
state to clean up. `-x` records the original SHA in each message, which is what makes the adopted
commits traceable back to the PR head later.

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
git add path/to/file                  # --theirs does not stage
```

`--theirs` only works on paths still marked as conflicted, and it takes upstream's _whole file_ — any
custom edits living in it are dropped too, including ones unrelated to the adopted PR. That is the
intent, not an accident: re-apply the local adaptations as a separate commit afterwards. Blending
hunk by hunk is where duplication bugs come from.

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

- **Depending on adopted code is fine.** Adopted code stays put by default, so a custom feature may
  build on an adopted PR freely. This is the main reason the no-revert default is worth its occasional
  conflicts.
- **The exception: reverting as a pre-sync optimisation.** If an adopted PR is self-contained, nothing
  custom builds on it, and upstream is known to have already merged its version into `main`, then
  `git revert -m 1 <merge-sha>` before syncing is the cheaper path — the conflict never materialises.
  Skipping it costs one conflict resolution, which is why it stays optional rather than becoming
  policy. Two things to know first: the revert leaves the adoption merge still "merged" as far as git
  is concerned, so re-adopting that branch later means reverting the revert; and if the assumption
  about upstream was wrong, the sync brings nothing back and the fix is silently gone.
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
- **Keep upstreamable work separate from fork-only work** from the first commit — one
  `custom/feature/*` branch per concern, and no custom dependencies in the ones headed upstream.
  Every branch now starts from the same base, so nothing forces this on you; untangling a mixed
  branch at promotion time is far more expensive than keeping it clean while writing it.
