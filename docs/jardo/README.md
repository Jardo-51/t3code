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
