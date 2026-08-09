---
name: adopt-upstream-pr
description: Adopt an unmerged pull request from upstream (pingdotgg/t3code) into this fork, following docs/jardo/forking-strategy.md. Takes the upstream PR number as its argument. Fetches the PR head, reviews the diff, cherry-picks it onto a custom/upstream-pr/* branch cut from custom/main, verifies it builds and tests, pushes the branch, and opens a PR into custom/main on the fork — it stops there without merging. Use when the user asks to adopt, vendor, pull in, or take an upstream PR by number.
---

# Adopt an upstream PR

Input: the upstream PR number, given as the skill argument (e.g. `/adopt-upstream-pr 5013`). It refers
to a PR on `pingdotgg/t3code`, never on this fork. If no number was given, ask for one and stop.

Throughout this skill, `<N>` is that number.

This implements the "Adopting unmerged upstream PRs" section of
[`docs/jardo/forking-strategy.md`](../../../docs/jardo/forking-strategy.md). Read that file if
anything here is ambiguous; it is the source of truth and explains the reasoning.

**Scope:** this skill ends with a PR open against `custom/main` on the fork. It does **not** merge
that PR, and it never pushes or opens anything on `pingdotgg/t3code`.

## 1. Preconditions

Run these and fix what is missing before touching the PR:

```bash
git status --porcelain          # must be empty; if not, stop and ask
git remote get-url upstream     # must be git@github.com:pingdotgg/t3code.git
git config rerere.enabled       # should be true
```

If `upstream` is missing, do the one-time setup from the strategy doc:

```bash
git remote add upstream git@github.com:pingdotgg/t3code.git
git remote set-url --push upstream DISABLED
git config rerere.enabled true
```

The `DISABLED` push URL is a deliberate guard against pushing to upstream by accident. Never remove
it, and never push anything to `upstream`.

A local `main` branch is required — it is the merge base for the cherry-pick range. Sync it (mirror of
upstream, fast-forward only):

```bash
git fetch upstream
git switch main && git merge --ff-only upstream/main
```

If `main` does not exist locally, create it: `git branch main upstream/main`. If `--ff-only` fails,
something was committed to `main` — stop and report it rather than reaching for a regular merge.

Also make sure `custom/main` is current with `origin`:

```bash
git switch custom/main && git pull --ff-only origin custom/main
```

## 2. Read the PR before running any of its code

**This is not optional.** T3 Code is an agent with shell access to the machine, and an upstream PR is
usually third-party, unreviewed code. Read the diff _before_ it lands on any branch you will build or
run.

```bash
gh pr view <N> --repo pingdotgg/t3code
gh pr diff <N> --repo pingdotgg/t3code
```

Read the whole diff. Flag to the user, before continuing, anything that:

- adds or changes network calls, telemetry, or credential/token handling
- shells out, spawns processes, or touches permission / sandbox / auth logic
- adds dependencies, postinstall scripts, or CI workflow changes
- touches version fields in `apps/desktop/package.json`, `apps/server/package.json`,
  `apps/web/package.json`, or `packages/contracts/package.json` (those conflict on every upstream
  release — see "Keeping the merge tax low")

If the PR is already merged upstream, say so and stop: it will arrive through the normal
`git merge main` sync and there is nothing to adopt.

## 3. Fetch the PR head

```bash
git fetch upstream pull/<N>/head:vendor/pr-<N>
```

- Fetch PRs **one at a time**. Never configure the blanket `+refs/pull/*/head:…` refspec — on a repo
  this active it drags in thousands of refs and every abandoned PR's objects.
- Never hand-copy a diff instead of fetching. Copying silently drops renames, deletions, mode changes,
  and binary files; there is no way to verify the result; and re-syncing when the author pushes an
  update becomes manual work.
- If `vendor/pr-<N>` already exists, the PR was fetched before. Update it with
  `git fetch upstream pull/<N>/head:vendor/pr-<N> --force` after confirming with the user, since that
  discards whatever the old ref pointed at.

`vendor/*` branches are raw upstream heads. Never merge one directly; only cherry-pick from it.

## 4. Cherry-pick onto an adoption branch

Branch from `custom/main` so the change lands in the context of the fork's own code and any conflicts
surface now rather than during a later sync.

Name the branch `custom/upstream-pr/<N>-<slug>`, where `<slug>` is a short kebab-case summary derived
from the PR title (e.g. `custom/upstream-pr/5013-local-bin-path`).

```bash
git switch -c custom/upstream-pr/<N>-<slug> custom/main
git cherry-pick -x --no-merges "$(git merge-base main vendor/pr-<N>)..vendor/pr-<N>"
```

Both flags are load-bearing — do not drop either:

- `--no-merges`: a PR open for a while usually has upstream merged into it. Without this, the
  cherry-pick applies a few commits and then aborts on the first merge commit (`is a merge but no -m
option was given`), leaving a half-applied sequencer state to clean up.
- `-x`: records the original SHA in each commit message, which is what makes the adopted commits
  traceable back to the PR head later.

On conflict: resolve it, `git add` the files, `git cherry-pick --continue`. Resolve toward keeping
both the fork's custom behaviour and the PR's intent — at this point upstream's version is _not_
canonical (the PR is unmerged), so do not blanket-take either side. If the conflicts are substantial
or you are unsure of the intent, `git cherry-pick --abort`, then report what conflicted and ask.

## 5. Verify

The PR was written against upstream's tree, not the fork's, so it can apply cleanly and still be
wrong here.

This repo drives everything through `vp` (Vite+), never `pnpm run` directly. If the PR touched
`package.json` or the lockfile, install first — module resolution will look broken otherwise:

```bash
vp i
```

Then verify **the scope the PR touched**, from the repo root — per `AGENTS.md`, do not run repo-wide
checks (`vp check`, `vp run -r test`, `vp run -r typecheck`) unless the user asks. The full suite
runs in CI on the PR that step 6 opens.

```bash
vp test run <files the PR touched>              # tests
vp lint <paths the PR touched>                  # lint
vp run --filter <package> typecheck             # types, per affected package
```

Workspace package names for `--filter`: `t3` (`apps/server`), `@t3tools/web`, `@t3tools/desktop`,
`@t3tools/mobile`, `@t3tools/marketing`, and `@t3tools/{client-runtime,contracts,shared,ssh,tailscale}`,
plus `effect-acp` and `effect-codex-app-server`.

A PR touching `packages/contracts` crosses the wire, so typecheck the consumers too — server, web,
mobile, and desktop all follow the schema.

Then check specifically for **semantic duplication** — the one real hazard with adopted code:
a registration, switch arm, provider entry, or migration that now exists twice because the PR added
one next to an existing one. Grep for the identifiers the PR introduces.

Fix fork-specific breakage in **separate commits on top** of the cherry-picked ones — keep the adopted
commits patch-identical to upstream's so they stay recognisable later.

## 6. Push and open the PR

```bash
git push -u origin custom/upstream-pr/<N>-<slug>
```

Then open the PR against `custom/main` **on the fork**:

```bash
gh pr create --repo Jardo-51/t3code \
  --base custom/main \
  --head custom/upstream-pr/<N>-<slug> \
  --title "vendor: adopt upstream PR #<N> (<short description>)" \
  --body "<body from below>"
```

Pass `--repo`, `--base`, and `--head` explicitly every time. This clone has an `upstream` remote, so
without them `gh` may target `pingdotgg/t3code` — proposing someone else's unmerged work to upstream
as our own.

Keep the `#<N>` in the title. That number is archaeology, not bookkeeping: when a conflict appears in
this code weeks later, `git log --grep='PR #<N>'` explains instantly why the code is contested and
points at the upstream PR to see how it changed. Whoever merges should keep it in the merge subject
too.

Body:

- a link to the upstream PR and a one-line summary of what it changes
- anything flagged in step 2, called out plainly
- what was verified in step 5, and anything that was **not** verified
- any fork-specific fixup commits added on top, and why
- a note that this is adopted third-party code, permanent by default, to be resolved toward
  upstream's version when upstream lands its own

Stop here. Do not merge the PR.

Then report the branch name, the PR URL, and the step 2 flags to the user.

## Rules that outlive this skill

- The adoption is **permanent by default**. Once merged into `custom/main` it is maintained like any
  other custom change: do not revert it to make a future sync easier. When upstream lands its own
  version, sync normally with `git merge main` and resolve the conflict **toward upstream's version
  wholesale** (`git checkout --theirs <path>` then `git add <path>` — `--theirs` does not stage), then
  re-apply local adaptations as a separate commit. Blending hunk by hunk is where duplication bugs
  come from.
- **Never merge a `custom/upstream-pr/*` branch into a `feature/*` branch.** That would propose
  someone else's unmerged work to upstream as our own.
- Custom features may depend on adopted code freely — that is the point of the no-revert default.
