import {
  type EnvironmentId,
  type JCustomUsageLimit,
  JCustomUsageLimitId,
  type JCustomUsageLimitProvider,
  type UnifiedSettings,
} from "@t3tools/contracts";
import { formatUsd } from "@t3tools/shared/usageFormat";
import { useAtomValue } from "@effect/atom-react";
import { PlusIcon } from "lucide-react";
import { useId, useState } from "react";

import { useUpdateEnvironmentSettings } from "../../hooks/useSettings";
import { randomUUID } from "../../lib/utils";
import { serverEnvironment } from "../../state/server";
import { jProviderOptionsAtom, jProviderKey } from "../usage/jCustomUsageLimitsState";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { searchableSetting } from "./settingsSearch";
import { SettingsRow, SettingsSection } from "./settingsLayout";

type Editing = { readonly id: JCustomUsageLimitId; readonly limit: JCustomUsageLimit | null };

export function JCustomUsageLimitSettings({
  environmentId,
  environmentLabel,
  limits,
  readOnly,
}: {
  readonly environmentId: EnvironmentId;
  readonly environmentLabel: string;
  readonly limits: UnifiedSettings["jCustomUsageLimits"];
  readonly readOnly: boolean;
}) {
  const supported =
    useAtomValue(serverEnvironment.configValueAtom(environmentId))?.environment.capabilities
      .jCustomUsageLimits === true;
  const updateSettings = useUpdateEnvironmentSettings(environmentId);
  const options = useAtomValue(jProviderOptionsAtom);
  const [editing, setEditing] = useState<Editing | null>(null);
  if (!supported) return null;
  const names = new Map(options.map((option) => [option.key, option.name]));
  const entries = Object.entries(limits) as Array<[JCustomUsageLimitId, JCustomUsageLimit]>;

  return (
    <>
      <SettingsSection
        {...searchableSetting("custom-usage-limits")}
        headerAction={
          !readOnly ? (
            <Button
              size="xs"
              variant="outline"
              onClick={() =>
                setEditing({ id: JCustomUsageLimitId.make(randomUUID()), limit: null })
              }
            >
              <PlusIcon className="size-3" aria-hidden />
              Add limit
            </Button>
          ) : null
        }
      >
        {entries.length === 0 ? (
          <SettingsRow
            title="No custom limits."
            description="Track a monthly spending limit, such as a corporate API budget, on the Limits tab of the Usage page."
          />
        ) : (
          entries.map(([id, limit]) => (
            <SettingsRow
              key={id}
              title={limit.name}
              description={
                <span>
                  {formatUsd(limit.limitUsd)} a month
                  {limit.markupPercent > 0 ? ` · +${limit.markupPercent}% markup` : ""}
                  {" · "}
                  {limit.providers.length === 0
                    ? "No providers"
                    : limit.providers
                        .map((provider) => names.get(jProviderKey(provider)) ?? provider.instanceId)
                        .join(", ")}
                </span>
              }
              control={
                !readOnly ? (
                  <div className="flex gap-1">
                    <Button size="xs" variant="ghost" onClick={() => setEditing({ id, limit })}>
                      Edit
                    </Button>
                    <RemoveLimitButton
                      name={limit.name}
                      onConfirm={() => updateSettings({ jCustomUsageLimits: { [id]: null } })}
                    />
                  </div>
                ) : null
              }
            />
          ))
        )}
      </SettingsSection>
      {editing && !readOnly ? (
        <CustomLimitDialog
          key={editing.id}
          environmentLabel={environmentLabel}
          initial={editing.limit}
          onCancel={() => setEditing(null)}
          onSave={(limit) => {
            updateSettings({ jCustomUsageLimits: { [editing.id]: limit } });
            setEditing(null);
          }}
        />
      ) : null}
    </>
  );
}

function parseAmount(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function CustomLimitDialog({
  environmentLabel,
  initial,
  onCancel,
  onSave,
}: {
  readonly environmentLabel: string;
  readonly initial: JCustomUsageLimit | null;
  readonly onCancel: () => void;
  readonly onSave: (limit: JCustomUsageLimit) => void;
}) {
  const options = useAtomValue(jProviderOptionsAtom);
  const formId = useId();
  const [name, setName] = useState(initial?.name ?? "");
  const [limitUsd, setLimitUsd] = useState(initial ? String(initial.limitUsd) : "");
  const [markup, setMarkup] = useState(initial ? String(initial.markupPercent) : "0");
  const [selected, setSelected] = useState<ReadonlyMap<string, JCustomUsageLimitProvider>>(
    () => new Map((initial?.providers ?? []).map((provider) => [jProviderKey(provider), provider])),
  );

  // Keep chosen providers that are offline or no longer countable, so editing a limit never
  // drops them silently.
  const known = new Set(options.map((option) => option.key));
  const rows = [
    ...options.filter((option) => option.countable || selected.has(option.key)),
    ...[...selected]
      .filter(([key]) => !known.has(key))
      .map(([key, provider]) => ({
        key,
        provider,
        name: provider.instanceId,
        environmentLabel: "Not connected",
        countable: true,
      })),
  ];
  const groups = new Map<EnvironmentId, { label: string; rows: typeof rows }>();
  for (const row of rows) {
    const group = groups.get(row.provider.environmentId);
    if (group) group.rows.push(row);
    else groups.set(row.provider.environmentId, { label: row.environmentLabel, rows: [row] });
  }

  const parsedLimit = parseAmount(limitUsd);
  const parsedMarkup = parseAmount(markup);
  const canSave =
    name.trim().length > 0 &&
    parsedLimit !== null &&
    parsedLimit > 0 &&
    parsedMarkup !== null &&
    parsedMarkup >= 0 &&
    selected.size > 0;

  const save = () => {
    if (!canSave) return;
    onSave({
      name: name.trim(),
      limitUsd: parsedLimit,
      markupPercent: parsedMarkup,
      providers: [...selected.values()],
    });
  };

  const toggle = (key: string, provider: JCustomUsageLimitProvider, checked: boolean) => {
    const next = new Map(selected);
    if (checked) next.set(key, provider);
    else next.delete(key);
    setSelected(next);
  };

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onCancel())}>
      <DialogPopup className="max-w-md">
        <DialogHeader>
          <DialogTitle>{initial ? "Edit custom limit" : "Add a custom limit"}</DialogTitle>
          <DialogDescription>
            Counts the priced usage of the chosen providers from 00:00 UTC on the 1st of each month.
            Saved on {environmentLabel}; providers on other environments count while they are
            connected.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <form
            id={formId}
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              save();
            }}
          >
            <div className="grid gap-1.5">
              <Label htmlFor="custom-limit-name">Name</Label>
              <Input
                id="custom-limit-name"
                placeholder="Corporate API"
                value={name}
                onChange={(event) => setName(event.target.value)}
                autoFocus
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="custom-limit-amount">Monthly limit (USD)</Label>
                <Input
                  id="custom-limit-amount"
                  inputMode="decimal"
                  placeholder="1000"
                  value={limitUsd}
                  onChange={(event) => setLimitUsd(event.target.value)}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="custom-limit-markup">Markup (%)</Label>
                <Input
                  id="custom-limit-markup"
                  inputMode="decimal"
                  value={markup}
                  onChange={(event) => setMarkup(event.target.value)}
                />
              </div>
            </div>
            <div className="grid gap-1.5">
              <span className="text-sm font-medium text-foreground">Providers</span>
              {rows.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No connected environment has providers whose usage a limit can count.
                </p>
              ) : (
                <div className="divide-y divide-border/60 rounded-lg border border-input bg-muted/25">
                  {[...groups].map(([environmentId, group]) => (
                    <div key={environmentId} className="py-1">
                      <span className="block px-3 pt-1.5 text-xs text-muted-foreground">
                        {group.label}
                      </span>
                      {group.rows.map((row) => (
                        <label
                          key={row.key}
                          className="flex cursor-pointer items-center gap-3 px-3 py-1.5 transition-colors hover:bg-muted/40"
                        >
                          <Checkbox
                            checked={selected.has(row.key)}
                            onCheckedChange={(checked) =>
                              toggle(row.key, row.provider, checked === true)
                            }
                          />
                          <span className="min-w-0 truncate text-xs font-medium text-foreground">
                            {row.name}
                          </span>
                          {row.countable ? null : (
                            <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                              Not counted
                            </span>
                          )}
                        </label>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </form>
        </DialogPanel>
        <DialogFooter variant="bare">
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button form={formId} type="submit" disabled={!canSave}>
            {initial ? "Save limit" : "Add limit"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

function RemoveLimitButton({
  name,
  onConfirm,
}: {
  readonly name: string;
  readonly onConfirm: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="xs" variant="ghost" onClick={() => setOpen(true)}>
        Remove
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {name}?</AlertDialogTitle>
            <AlertDialogDescription>
              The limit leaves the Limits view. Usage history is not affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>Cancel</AlertDialogClose>
            <Button
              variant="destructive"
              onClick={() => {
                setOpen(false);
                onConfirm();
              }}
            >
              Remove limit
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </>
  );
}
