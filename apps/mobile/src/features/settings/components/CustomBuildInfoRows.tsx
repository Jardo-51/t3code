import Constants from "expo-constants";
import { View } from "react-native";

import type { CustomBuildInfo } from "../../../../../../custom/build-info";
import { SymbolView } from "../../../components/AppSymbol";
import { AppText as Text } from "../../../components/AppText";

const builtAtFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "long",
});

export function CustomBuildInfoRows() {
  const buildInfo = Constants.expoConfig?.extra?.customBuildInfo as CustomBuildInfo | undefined;
  if (!buildInfo) return null;

  const builtAt = new Date(buildInfo.builtAt);
  const refTypeLabel =
    buildInfo.refType === "tag"
      ? "Tag"
      : buildInfo.refType === "branch"
        ? "Branch"
        : "Detached checkout";

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
          <Text className="text-lg text-foreground">Build source</Text>
          <Text className="text-sm text-foreground-muted">
            {refTypeLabel} {buildInfo.refName}
            {buildInfo.dirty ? " with uncommitted changes" : ""}
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
          <Text className="text-lg text-foreground">Built</Text>
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
