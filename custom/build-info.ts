// @effect-diagnostics nodeBuiltinImport:off - Build bootstrap reads Git before an Effect runtime exists.
import * as NodeChildProcess from "node:child_process";

export interface CustomBuildInfo {
  readonly refName: string;
  readonly refType: "branch" | "tag" | "detached";
  readonly commitSha: string;
  readonly builtAt: string;
  readonly dirty: boolean;
}

function nonEmpty(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function runGit(repoRoot: string | URL, args: ReadonlyArray<string>): string | null {
  const result = NodeChildProcess.spawnSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    windowsHide: true,
  });

  return result.status === 0 ? nonEmpty(result.stdout) : null;
}

function resolveBuildTime(env: NodeJS.ProcessEnv): string {
  const explicit = nonEmpty(env.T3CODE_CUSTOM_BUILD_TIME);
  if (explicit) return new Date(explicit).toISOString();

  const sourceDateEpoch = nonEmpty(env.SOURCE_DATE_EPOCH);
  if (sourceDateEpoch && /^\d+$/u.test(sourceDateEpoch)) {
    return new Date(Number(sourceDateEpoch) * 1_000).toISOString();
  }

  return new Date().toISOString();
}

export function resolveCustomBuildInfo(
  repoRoot: string | URL,
  env: NodeJS.ProcessEnv = process.env,
): CustomBuildInfo {
  const explicitRef = nonEmpty(env.T3CODE_CUSTOM_BUILD_REF);
  const exactTag = runGit(repoRoot, ["describe", "--tags", "--exact-match", "HEAD"]);
  const branch = runGit(repoRoot, ["branch", "--show-current"]);
  const ciTag =
    env.GITHUB_REF_TYPE === "tag" ? nonEmpty(env.GITHUB_REF_NAME) : nonEmpty(env.CI_COMMIT_TAG);
  const ciBranch =
    nonEmpty(env.GITHUB_HEAD_REF) ??
    (env.GITHUB_REF_TYPE === "branch" ? nonEmpty(env.GITHUB_REF_NAME) : null) ??
    nonEmpty(env.VERCEL_GIT_COMMIT_REF) ??
    nonEmpty(env.CI_COMMIT_REF_NAME);
  const refName = explicitRef ?? exactTag ?? branch ?? ciTag ?? ciBranch ?? "detached HEAD";
  const explicitRefType = nonEmpty(env.T3CODE_CUSTOM_BUILD_REF_TYPE);
  const refType =
    explicitRefType === "tag" || explicitRefType === "branch" || explicitRefType === "detached"
      ? explicitRefType
      : exactTag || ciTag
        ? "tag"
        : branch || ciBranch
          ? "branch"
          : "detached";

  return {
    refName,
    refType,
    commitSha:
      nonEmpty(env.T3CODE_CUSTOM_BUILD_SHA) ??
      runGit(repoRoot, ["rev-parse", "HEAD"]) ??
      nonEmpty(env.GITHUB_SHA) ??
      nonEmpty(env.VERCEL_GIT_COMMIT_SHA) ??
      nonEmpty(env.CI_COMMIT_SHA) ??
      "unknown",
    builtAt: resolveBuildTime(env),
    dirty: runGit(repoRoot, ["status", "--porcelain", "--untracked-files=normal"]) !== null,
  };
}
