import { DEFAULT_UNIFIED_SETTINGS } from "@t3tools/contracts/settings";

import { useClientSettings, useUpdateClientSettings } from "~/hooks/useSettings";
import { SettingResetButton, SettingsRow } from "../settings/settingsLayout";
import { searchableSetting } from "../settings/settingsSearch";
import { Switch } from "../ui/switch";

/** Device-local toggles for the link badges on sidebar rows; a narrow sidebar may fit only one. */
export function SidebarLinkBadgeSettings() {
  const showPullRequests = useClientSettings((settings) => settings.jSidebarShowPullRequests);
  const showTickets = useClientSettings((settings) => settings.jSidebarShowTickets);
  const updateSettings = useUpdateClientSettings();
  return (
    <>
      <SettingsRow
        {...searchableSetting("sidebar-pull-request-badges")}
        description="Show each thread's pull request beside it in the sidebar."
        resetAction={
          showPullRequests !== DEFAULT_UNIFIED_SETTINGS.jSidebarShowPullRequests ? (
            <SettingResetButton
              label="pull requests in sidebar"
              onClick={() =>
                updateSettings({
                  jSidebarShowPullRequests: DEFAULT_UNIFIED_SETTINGS.jSidebarShowPullRequests,
                })
              }
            />
          ) : null
        }
        control={
          <Switch
            checked={showPullRequests}
            onCheckedChange={(checked) =>
              updateSettings({ jSidebarShowPullRequests: Boolean(checked) })
            }
            aria-label="Pull requests in sidebar"
          />
        }
      />
      <SettingsRow
        {...searchableSetting("sidebar-ticket-badges")}
        description="Show each thread's linked ticket beside it in the sidebar."
        resetAction={
          showTickets !== DEFAULT_UNIFIED_SETTINGS.jSidebarShowTickets ? (
            <SettingResetButton
              label="tickets in sidebar"
              onClick={() =>
                updateSettings({
                  jSidebarShowTickets: DEFAULT_UNIFIED_SETTINGS.jSidebarShowTickets,
                })
              }
            />
          ) : null
        }
        control={
          <Switch
            checked={showTickets}
            onCheckedChange={(checked) => updateSettings({ jSidebarShowTickets: Boolean(checked) })}
            aria-label="Tickets in sidebar"
          />
        }
      />
    </>
  );
}
