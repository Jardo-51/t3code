# Custom build provenance

This fork embeds source provenance in every web, desktop, iOS, and Android build. The web and
desktop clients show it under **Settings → General → About**; mobile shows it in the **App**
settings section.

[`build-info.ts`](./build-info.ts) normally reads the exact tag or current branch, full commit SHA,
working-tree state, and build time directly from Git. Detached CI checkouts fall back to GitHub,
Vercel, or GitLab environment variables. `SOURCE_DATE_EPOCH` is honored for reproducible builds.

Source archives without `.git` can provide explicit values:

- `T3CODE_CUSTOM_BUILD_REF`
- `T3CODE_CUSTOM_BUILD_REF_TYPE` (`branch`, `tag`, or `detached`)
- `T3CODE_CUSTOM_BUILD_SHA`
- `T3CODE_CUSTOM_BUILD_TIME` (a date-time accepted by JavaScript)

The fork-specific implementation lives in `custom/` and app-local `CustomBuildInfoRows` files.
Only small import/configuration hooks live in upstream-owned files, to keep future upstream syncs
localized.
