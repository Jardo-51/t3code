import { T, useGT, Var } from "gt-react";

import { SettingsRow } from "../components/settings/settingsLayout";

interface CustomBuildInfo {
  readonly refName: string;
  readonly refType: "branch" | "tag" | "detached";
  readonly commitSha: string;
  readonly builtAt: string;
  readonly dirty: boolean;
}

declare const __T3CODE_CUSTOM_BUILD_INFO__: CustomBuildInfo;

const buildInfo = __T3CODE_CUSTOM_BUILD_INFO__;

const builtAtFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "long",
});

export function CustomBuildInfoRows() {
  const gt = useGT();
  const builtAt = new Date(buildInfo.builtAt);
  const refTypeLabel =
    buildInfo.refType === "tag"
      ? gt("Tag", { $context: "git tag" })
      : buildInfo.refType === "branch"
        ? gt("Branch", { $context: "git branch" })
        : gt("Detached checkout");
  const ref = <code className="text-foreground/80">{buildInfo.refName}</code>;

  return (
    <>
      <SettingsRow
        title={gt("Build source")}
        description={
          <span className="flex flex-col gap-0.5">
            <span>
              {buildInfo.dirty ? (
                <T>
                  <Var>{refTypeLabel}</Var> <Var>{ref}</Var> with uncommitted changes
                </T>
              ) : (
                <>
                  {refTypeLabel} {ref}
                </>
              )}
            </span>
            <code className="break-all text-2xs text-foreground/80">{buildInfo.commitSha}</code>
          </span>
        }
      />
      <SettingsRow
        title={gt("Built", { $context: "when the app was built" })}
        description={
          <time dateTime={buildInfo.builtAt}>
            {Number.isNaN(builtAt.getTime())
              ? buildInfo.builtAt
              : `${builtAtFormatter.format(builtAt)} (${buildInfo.builtAt})`}
          </time>
        }
      />
    </>
  );
}
