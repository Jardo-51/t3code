---
name: update-fork-to-upstream
description: Update this fork to a specific upstream (pingdotgg/t3code) release, following docs/jardo/forking-strategy.md. Takes the upstream tag as its argument (e.g. v0.1.12). Releases the current fork version (dates its CHANGELOG entry, tags custom/main), fast-forwards main to the upstream tag and pushes it, merges main into custom/main resolving conflicts, verifies the web build, opens a new Unreleased CHANGELOG entry, and pushes custom/main. Use when the user asks to update / sync / bump the fork to an upstream version or tag.
---

# Update the fork to an upstream release

Input: an upstream tag, given as the skill argument (e.g. `/update-fork-to-upstream v0.1.12`). It
names a tag on `pingdotgg/t3code`. If no tag was given, ask for one and stop.

Throughout this skill:

- `<TAG>` is that tag, e.g. `v0.1.12`.
- `<NEXT>` is the fork version built on it: `<TAG>` without the leading `v`, plus `-jardo.1`, e.g.
  `0.1.12-jardo.1`.
- `<CURRENT>` is the version in the `Unreleased` heading of
  [`docs/jardo/CHANGELOG.md`](../../../docs/jardo/CHANGELOG.md), e.g. `0.1.9-jardo.1`.

This implements the "Syncing `main` with upstream" and "Syncing upstream into `custom/main`" sections
of [`docs/jardo/forking-strategy.md`](../../../docs/jardo/forking-strategy.md). Read that file if
anything here is ambiguous; it is the source of truth.

Never push anything to `upstream`. Never force-push `main` or `custom/main`, and never rebase
`custom/main`.

## 1. Preconditions

```bash
git status --porcelain          # must be empty; if not, stop and ask
git remote get-url upstream     # must be git@github.com:pingdotgg/t3code.git
git config rerere.enabled       # should be true; set it if not
git fetch upstream --tags
git rev-parse --verify "<TAG>^{commit}"   # the tag must exist upstream
git switch custom/main && git pull --ff-only origin custom/main
```

If `upstream` is missing, do the one-time setup from the strategy doc (including the `DISABLED` push
URL) before continuing.

Then check the input makes sense, and stop and ask if it does not:

- The CHANGELOG has exactly one `## [<CURRENT>] - Unreleased` heading.
- `<TAG>` is ahead of the current base: `git merge-base --is-ancestor main <TAG>` succeeds and
  `git rev-parse main` differs from `git rev-parse "<TAG>^{commit}"`. A tag that is behind `main`
  would be a downgrade.
- `main` is already fully merged: `git merge-base --is-ancestor main custom/main`.

## 2. Release the current version

In `docs/jardo/CHANGELOG.md`, replace the `Unreleased` in `## [<CURRENT>] - Unreleased` with the
current UTC date (`date -u +%F`). Touch nothing else in the file.

```bash
git add docs/jardo/CHANGELOG.md
git commit -m "Update changelog"
```

Tag that commit with the UTC time of tagging and the released version, as a lightweight tag (the
established format, e.g. `2026-11-14_11-37_v0.1.6-jardo.1`):

```bash
git tag "$(date -u +%Y-%m-%d_%H-%M)_v<CURRENT>"
```

Note the tag name; it is pushed in step 7.

## 3. Fast-forward `main` to the tag

```bash
git switch main
git merge --ff-only "<TAG>^{commit}"
git push origin main
```

If `--ff-only` fails, something was committed to `main`. Stop and report it; never fall back to a
regular merge.

## 4. Merge `main` into `custom/main`

Note the pre-merge SHA (`git rev-parse custom/main`) as the escape hatch, then:

```bash
git switch custom/main
git merge main --no-edit
```

`rerere` replays resolutions it has recorded before. For the rest, resolve every conflict yourself,
without asking, using these rules:

- **Version fields** (`version` in `apps/desktop`, `apps/server`, `apps/web`,
  `packages/contracts` `package.json`): take upstream's value.
- **Lockfile** (`pnpm-lock.yaml`): take upstream's (`git checkout --theirs pnpm-lock.yaml`), resolve
  the `package.json` files, then regenerate it with `vp i` once the merge is otherwise done, and
  stage the result.
- **Code from an adopted upstream PR** (`git log --grep='PR #'` and `custom/upstream-pr/*` merges
  identify it) that upstream has now merged in its own form: take upstream's whole file
  (`git checkout --theirs <path> && git add <path>`), then re-apply any unrelated custom edits in that
  file as a separate commit after the merge.
- **Custom features** (`git log --oneline --no-merges main..custom/main` lists them): keep both
  upstream's change and the fork's behaviour, adapting the custom code to upstream's new shape. Read
  both sides (`git diff --merge <path>`, `git log main -- <path>`) before editing.

Search for leftover markers before committing: `git diff --check` and
`git grep -nE '^(<<<<<<<|>>>>>>>)' -- ':!*.md'`. Then `git commit --no-edit`, keeping the default
`Merge branch 'main' into custom/main` subject.

Stop and ask only when a conflict cannot be resolved without dropping or redesigning a custom
feature, for example when upstream deleted or rewrote the code a feature depends on. Describe what
conflicts and the options. If the user wants to bail out, `git merge --abort` (or reset to the noted
pre-merge SHA if the merge was already committed).

After the merge, check for **semantic duplication**: a registration, switch arm, provider entry, or
migration now present twice because upstream added one next to a custom one. Grep for the
identifiers of adopted PRs and custom features the merge touched.

## 5. Verify the build

Install if the lockfile or any `package.json` changed, then build the web app:

```bash
vp i
cd apps/web && vp build
```

If it fails, fix the cause in separate commits on `custom/main` after the merge commit, and rebuild
until it passes. Also typecheck the packages the conflict resolution touched
(`vp run --filter <package> typecheck`) and run the tests beside the files you edited
(`vp test run <files>`). Do not run repo-wide checks.

## 6. Open the next version

Add a new entry above `## [<CURRENT>] - <date>` in `docs/jardo/CHANGELOG.md`:

```markdown
## [<NEXT>] - Unreleased
```

If the merge changed or removed a custom feature, record it in that entry under `### Changed` or
`### Removed` in the file's existing style. Otherwise leave the entry empty.

```bash
git add docs/jardo/CHANGELOG.md
git commit -m "Update changelog"
```

## 7. Push

```bash
git push origin custom/main "<tag from step 2>"
```

Report to the user: the release tag, the old and new upstream base, each conflict and how it was
resolved, any fixup commits, and the build and test results.
