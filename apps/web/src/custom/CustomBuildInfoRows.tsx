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
  const builtAt = new Date(buildInfo.builtAt);
  const refTypeLabel =
    buildInfo.refType === "tag"
      ? "Tag"
      : buildInfo.refType === "branch"
        ? "Branch"
        : "Detached checkout";

  return (
    <>
      <SettingsRow
        title="Build source"
        description={
          <span className="flex flex-col gap-0.5">
            <span>
              {refTypeLabel} <code className="text-foreground/80">{buildInfo.refName}</code>
              {buildInfo.dirty ? " with uncommitted changes" : ""}
            </span>
            <code className="break-all text-[11px] text-foreground/80">{buildInfo.commitSha}</code>
          </span>
        }
      />
      <SettingsRow
        title="Built"
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
