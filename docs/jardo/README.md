# Development

## Run in dev mode

```sh
node scripts/dev-runner.ts dev --no-browser
```

# Daily use

## Build package (once)

```sh
cd apps/web && vp build
```

## Run

```sh
apps/server/src/bin.ts --no-browser --no-auto-bootstrap-project-from-cwd --host 0.0.0.0
```

# Android app

## Build a sideloadable APK

The `Custom Android APK` workflow (`.github/workflows/custom-android-apk.yml`) builds the mobile app
from source on a GitHub-hosted runner and uploads the APK as a workflow artifact. It uses no Expo
account, no EAS build, and no store.

1. Actions → **Custom Android APK** → **Run workflow**, pick the branch and variant.
2. When it finishes (roughly 25-40 minutes cold, less with a warm Gradle cache), download the
   artifact from the run summary and unzip it.
3. Copy the APK to the phone and install it. Android asks to allow installing unknown apps from
   whichever app opened the file; that permission is per-source and only needs granting once.

`production` builds `com.t3tools.t3code` ("T3 Code"), `preview` builds `com.t3tools.t3code.preview`
("T3 Code Preview") and installs alongside it. Both are signed with the keystore Expo's Android
template ships, so successive builds install over each other as upgrades and keep their data. That
key is public: it is fine for sideloading your own builds, not for handing the APK to anyone else.

A `workflow_dispatch` workflow only appears in the Actions UI once the file is on the default branch
(`custom/main`), so merge it there before the first run.
