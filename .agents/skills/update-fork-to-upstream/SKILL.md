---
name: update-fork-to-upstream
description: Update this fork to a specific upstream (pingdotgg/t3code) release, following docs/jardo/forking-strategy.md. Takes the upstream tag as its argument (e.g. v0.1.12). Releases the current fork version (dates its CHANGELOG entry, tags custom/main), fast-forwards main to the upstream tag and pushes it, merges main into custom/main resolving conflicts, verifies the fork's code (build, typecheck, fork tests, lint, translations), opens a new Unreleased CHANGELOG entry, and pushes custom/main. Use when the user asks to update / sync / bump the fork to an upstream version or tag.
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
- **Translation catalogs** (`apps/{web,mobile,desktop}/src/i18n/translations/*.json`): take
  upstream's (`git checkout --theirs <path> && git add <path>`). Step 5 regenerates them and puts
  the fork's translations back.
- **Custom features** (`git log --oneline --no-merges main..custom/main` lists them): keep both
  upstream's change and the fork's behaviour, adapting the custom code to upstream's new shape. Read
  both sides (`git diff --merge <path>`, `git log main -- <path>`) before editing.

Search for leftover markers before committing: `git diff --check` and
`git grep -nE '^(<<<<<<<|>>>>>>>)' -- ':!*.md' ':!patches/**'` (upstream's own patch files may
carry trailing whitespace). Then commit, keeping the default `Merge branch 'main' into custom/main`
subject:

```bash
git commit --no-edit --no-verify
```

`--no-verify` is deliberate here: the pre-commit hook would lint every file the whole upstream range
touched. Step 5 verifies the result instead, and its fixup commits run the hook normally.

Stop and ask only when a conflict cannot be resolved without dropping or redesigning a custom
feature, for example when upstream deleted or rewrote the code a feature depends on. Describe what
conflicts and the options. If the user wants to bail out, `git merge --abort` (or reset to the noted
pre-merge SHA if the merge was already committed).

After the merge, check for **semantic duplication**: a registration, switch arm, provider entry, or
migration now present twice because upstream added one next to a custom one. Grep for the
identifiers of adopted PRs and custom features the merge touched.

Also look for **overlapping features**: upstream shipping its own version of something a custom
feature does (for example upstream issue linking next to the fork's ticket links). Keep both, and
name each overlap in the report so the user can decide whether to retire the fork's version.

## 5. Verify

Most breakage shows up in fork files that merged cleanly but use an upstream API that changed, so
check every fork file, not only the ones that conflicted. The fork's files are:

```bash
git diff --name-only --diff-filter=AM main custom/main
```

Fix each failure in its own commit on `custom/main` after the merge commit, and repeat the failing
check until it passes. Do not run repo-wide checks.

1. **Install** if the lockfile or any `package.json` changed: `vp i`. Running this skill is the
   user's approval for that install. If pnpm aborts with
   `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`, rerun it as
   `vp i -- --config.confirmModulesPurge=false`. After an install that changed dependencies, clear
   `apps/web/node_modules/.vite/deps`.
2. **Build** the web app: `cd apps/web && vp build`.
3. **Typecheck** every package that contains fork code (the server package is named `t3`):

   ```bash
   for dir in $(git diff --name-only main custom/main -- apps packages | cut -d/ -f1-2 | sort -u); do
     node -p "require('./$dir/package.json').name"
   done
   vp run --filter <name> [--filter <name> ...] --concurrency-limit 1 typecheck
   ```

4. **Test** the fork's own tests: the `*.test.ts(x)` files in the fork file list, run with
   `vp test run <files>` from their package. Browser tests (`*.browser.test.*`) need Playwright; run
   them where it is available, otherwise list them as not run in the report. A fork test that fails
   because upstream changed the behaviour it relied on gets its expectation updated, not the code
   reverted.
5. **Lint and format** the fork's `.ts`/`.tsx` files: `vp lint <files>` and `vp fmt --check <files>`.
   This catches new upstream lint rules that fork code now breaks.
6. **Translations**: run `vp run i18n:check`. If it fails, or step 4 took upstream's catalogs:
   1. Run `vp run i18n:generate` in `apps/web` and `apps/mobile` (and `apps/desktop` if the fork
      list includes its translations). New keys get English values in every locale.
   2. Restore the fork's translations from the pre-merge SHA noted in step 4. This script copies
      every fork-only key's value back and lists keys that are new since then:

      ```bash
      PRE_MERGE=<pre-merge SHA> node --input-type=module - <<'EOF'
      import { execFileSync } from "node:child_process";
      import { readdirSync, readFileSync, writeFileSync } from "node:fs";
      // Catalogs exceed execFileSync's default 1 MiB buffer.
      const show = (ref, file) => {
        try {
          const options = { encoding: "utf8", maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "ignore"] };
          return JSON.parse(execFileSync("git", ["show", `${ref}:${file}`], options));
        } catch {
          return null;
        }
      };
      const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
      for (const app of ["web", "mobile", "desktop"]) {
        const dir = `apps/${app}/src/i18n/translations`;
        const en = JSON.parse(readFileSync(`${dir}/en.json`, "utf8"));
        for (const name of readdirSync(dir).filter((f) => f.endsWith(".json") && f !== "en.json")) {
          const file = `${dir}/${name}`;
          const catalog = JSON.parse(readFileSync(file, "utf8"));
          const fork = show(process.env.PRE_MERGE, file) ?? {};
          const upstream = show("main", file) ?? {};
          let restored = 0;
          const untranslated = [];
          for (const key of Object.keys(catalog)) {
            if (Object.hasOwn(upstream, key)) continue;
            if (!Object.hasOwn(fork, key)) {
              untranslated.push(`${key} ${JSON.stringify(en[key])}`);
              continue;
            }
            if (!same(catalog[key], fork[key])) restored += 1;
            catalog[key] = fork[key];
          }
          writeFileSync(file, `${JSON.stringify(catalog, null, 2)}\n`);
          if (restored > 0 || untranslated.length > 0) console.log(`${file}: restored ${restored}`);
          for (const entry of untranslated) console.log(`  new, translate: ${entry}`);
        }
      }
      EOF
      ```

   3. Translate every key it lists as new in each locale catalog, using the terms that catalog
      already uses for the same concepts. Then `vp fmt` the catalogs and rerun `vp run i18n:check`.

   Any string a fixup adds follows [Translating the UI](../../../docs/internals/i18n.md) and gets
   translated the same way.

If a check cannot run in the current environment, say which one and why in the report instead of
skipping it silently.

## 6. Open the next version

Add a new entry above `## [<CURRENT>] - <date>` in `docs/jardo/CHANGELOG.md`:

```markdown
## [<NEXT>] - Unreleased
```

If the merge or a step 5 fixup changed what a custom feature does or how it looks to the user
(including adapting it to new upstream behaviour, such as translating its UI), record it in that
entry under `### Changed`, or under `### Removed` if a feature went away, in the file's existing
style. Purely internal adaptations (renamed imports, new API shapes with the same behaviour) are not
recorded. Otherwise leave the entry empty.

```bash
git add docs/jardo/CHANGELOG.md
git commit -m "Update changelog"
```

## 7. Push

```bash
git push origin custom/main "<tag from step 2>"
```

Report to the user: the release tag, the old and new upstream base, each conflict and how it was
resolved, any fixup commits, the result of each step 5 check (and any that could not run), and the
overlapping upstream features from step 4.
