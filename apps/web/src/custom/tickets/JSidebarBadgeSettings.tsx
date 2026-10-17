import { type ClientSettings, DEFAULT_UNIFIED_SETTINGS } from "@t3tools/contracts";

import { SettingResetButton, SettingsRow } from "~/components/settings/settingsLayout";
import { searchableSetting } from "~/components/settings/settingsSearch";
import {
  useScopedSettings,
  useUpdateScopedSettings,
} from "~/components/settings/useScopedSettings";
import { Switch } from "~/components/ui/switch";

const BADGE_SETTINGS = [
  {
    key: "jSidebarShowPullRequests",
    searchId: "j-sidebar-pull-requests",
    label: "pull requests in sidebar",
    description: "Show a thread's pull request on its sidebar row.",
  },
  {
    key: "jSidebarShowTickets",
    searchId: "j-sidebar-tickets",
    label: "tickets in sidebar",
    description: "Show a thread's linked tickets on its sidebar row.",
  },
] as const satisfies ReadonlyArray<{ readonly key: keyof ClientSettings } & Record<string, string>>;

type BadgeSettings = Pick<ClientSettings, (typeof BADGE_SETTINGS)[number]["key"]>;

export function jSidebarBadgeChangedSettingLabels(settings: BadgeSettings): string[] {
  return BADGE_SETTINGS.filter(({ key }) => settings[key] !== DEFAULT_UNIFIED_SETTINGS[key]).map(
    ({ label }) => label.charAt(0).toUpperCase() + label.slice(1),
  );
}

export const J_SIDEBAR_BADGE_DEFAULTS: BadgeSettings = {
  jSidebarShowPullRequests: DEFAULT_UNIFIED_SETTINGS.jSidebarShowPullRequests,
  jSidebarShowTickets: DEFAULT_UNIFIED_SETTINGS.jSidebarShowTickets,
};

export function JSidebarBadgeSettings() {
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  return BADGE_SETTINGS.map(({ key, searchId, label, description }) => {
    const searchable = searchableSetting(searchId);
    return (
      <SettingsRow
        key={key}
        {...searchable}
        description={description}
        resetAction={
          settings[key] !== DEFAULT_UNIFIED_SETTINGS[key] ? (
            <SettingResetButton
              label={label}
              onClick={() => updateSettings({ [key]: DEFAULT_UNIFIED_SETTINGS[key] })}
            />
          ) : null
        }
        control={
          <Switch
            checked={settings[key]}
            onCheckedChange={(checked) => updateSettings({ [key]: Boolean(checked) })}
            aria-label={searchable.title}
          />
        }
      />
    );
  });
}
