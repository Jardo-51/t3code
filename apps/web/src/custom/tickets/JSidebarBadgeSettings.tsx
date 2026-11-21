import { type ClientSettings, DEFAULT_UNIFIED_SETTINGS } from "@t3tools/contracts";
import { msg, useMessages } from "gt-react";

import { SettingResetButton, SettingsRow } from "~/components/settings/settingsLayout";
import { useSearchableSetting } from "~/components/settings/settingsSearch";
import {
  useScopedSettings,
  useUpdateScopedSettings,
} from "~/components/settings/useScopedSettings";
import { Switch } from "~/components/ui/switch";
import type { MessageResolver } from "~/i18n/messages";

const BADGE_SETTINGS = [
  {
    key: "jSidebarShowPullRequests",
    searchId: "j-sidebar-pull-requests",
    title: msg("Pull requests in sidebar"),
    resetLabel: msg("Reset pull requests in sidebar to default"),
    description: msg("Show a thread's pull request on its sidebar row."),
  },
  {
    key: "jSidebarShowTickets",
    searchId: "j-sidebar-tickets",
    title: msg("Tickets in sidebar"),
    resetLabel: msg("Reset tickets in sidebar to default"),
    description: msg("Show a thread's linked tickets on its sidebar row."),
  },
] as const satisfies ReadonlyArray<{ readonly key: keyof ClientSettings } & Record<string, string>>;

type BadgeSettings = Pick<ClientSettings, (typeof BADGE_SETTINGS)[number]["key"]>;

export function jSidebarBadgeChangedSettingLabels(
  settings: BadgeSettings,
  resolve: MessageResolver,
): string[] {
  return BADGE_SETTINGS.filter(({ key }) => settings[key] !== DEFAULT_UNIFIED_SETTINGS[key]).map(
    ({ title }) => resolve(title),
  );
}

export const J_SIDEBAR_BADGE_DEFAULTS: BadgeSettings = {
  jSidebarShowPullRequests: DEFAULT_UNIFIED_SETTINGS.jSidebarShowPullRequests,
  jSidebarShowTickets: DEFAULT_UNIFIED_SETTINGS.jSidebarShowTickets,
};

export function JSidebarBadgeSettings() {
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const searchableSetting = useSearchableSetting();
  const messages = useMessages();
  return BADGE_SETTINGS.map(({ key, searchId, resetLabel, description }) => {
    const searchable = searchableSetting(searchId);
    return (
      <SettingsRow
        key={key}
        {...searchable}
        description={messages(description)}
        resetAction={
          settings[key] !== DEFAULT_UNIFIED_SETTINGS[key] ? (
            <SettingResetButton
              ariaLabel={messages(resetLabel)}
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
