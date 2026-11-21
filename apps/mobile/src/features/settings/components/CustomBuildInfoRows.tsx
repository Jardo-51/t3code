import Constants from "expo-constants";
import { T, useGT } from "gt-react-native";
import { View } from "react-native";

import type { CustomBuildInfo } from "../../../../../../custom/build-info";
import { SymbolView } from "../../../components/ui/AppSymbol";
import { AppText as Text } from "../../../components/ui/AppText";

const builtAtFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "long",
});

export function CustomBuildInfoRows() {
  const gt = useGT();
  const buildInfo = Constants.expoConfig?.extra?.customBuildInfo as CustomBuildInfo | undefined;
  if (!buildInfo) return null;

  const builtAt = new Date(buildInfo.builtAt);
  const refTypeLabel =
    buildInfo.refType === "tag"
      ? gt("Tag", { $context: "git tag" })
      : buildInfo.refType === "branch"
        ? gt("Branch", { $context: "git branch" })
        : gt("Detached checkout");

  return (
    <>
      <View className="flex-row items-start gap-4 p-4">
        <SymbolView
          name="point.3.connected.trianglepath.dotted"
          size={22}
          tintColorClassName="accent-icon"
          type="monochrome"
          weight="regular"
        />
        <View className="min-w-0 flex-1 gap-1">
          <Text className="text-lg text-foreground">
            <T>Build source</T>
          </Text>
          <Text className="text-sm text-foreground-muted">
            {buildInfo.dirty
              ? gt("{refType} {ref} with uncommitted changes", {
                  refType: refTypeLabel,
                  ref: buildInfo.refName,
                })
              : `${refTypeLabel} ${buildInfo.refName}`}
          </Text>
          <Text selectable className="font-t3-mono text-xs text-foreground-muted">
            {buildInfo.commitSha}
          </Text>
        </View>
      </View>
      <View className="flex-row items-start gap-4 p-4">
        <SymbolView
          name="clock"
          size={22}
          tintColorClassName="accent-icon"
          type="monochrome"
          weight="regular"
        />
        <View className="min-w-0 flex-1 gap-1">
          <Text className="text-lg text-foreground">
            {gt("Built", { $context: "when the app was built" })}
          </Text>
          <Text selectable className="text-sm text-foreground-muted">
            {Number.isNaN(builtAt.getTime()) ? buildInfo.builtAt : builtAtFormatter.format(builtAt)}
          </Text>
          <Text selectable className="font-t3-mono text-xs text-foreground-muted">
            {buildInfo.builtAt}
          </Text>
        </View>
      </View>
    </>
  );
}
