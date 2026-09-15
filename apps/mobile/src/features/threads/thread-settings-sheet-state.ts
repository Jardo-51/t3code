import type { ModelOption, ProviderGroup } from "../../lib/modelOptions";
import type { FavoriteModel } from "../../persistence/mobile-preferences";

/** Match the terms a user can actually see or recognize in the model picker. */
export function modelMatchesCatalogQuery(input: {
  readonly model: ModelOption;
  readonly providerLabel: string;
  readonly query: string;
}): boolean {
  const query = input.query.trim().toLocaleLowerCase();
  if (query.length === 0) {
    return true;
  }

  return [
    input.model.label,
    input.model.subtitle,
    input.model.selection.model,
    input.providerLabel,
  ].some((value) => value.toLocaleLowerCase().includes(query));
}

/** Preserve staged provider options when the highlighted model is tapped again. */
export function pendingModelAfterPress(input: {
  readonly current: ModelOption | null;
  readonly pressed: ModelOption;
  readonly pressedIsApplied: boolean;
}): ModelOption | null {
  if (input.pressedIsApplied) {
    return null;
  }
  return input.current?.key === input.pressed.key ? input.current : input.pressed;
}

/** A model can disappear while the picker is open. */
export function canCommitPendingModel(
  pending: ModelOption,
  groups: ReadonlyArray<ProviderGroup>,
): boolean {
  return groups.some((group) =>
    group.models.some((model) => model.key === pending.key && !model.isUnavailable),
  );
}

/**
 * Primary and selected providers start open; all other catalogs start closed.
 * A user's disclosure tap inverts that default until the picker is dismissed.
 */
export function providerSectionIsCollapsed(input: {
  readonly defaultExpanded: boolean;
  readonly hasExpansionOverride: boolean;
  readonly isNarrowed: boolean;
}): boolean {
  if (input.isNarrowed) {
    return false;
  }
  return input.defaultExpanded ? input.hasExpansionOverride : !input.hasExpansionOverride;
}

/** Whether a catalog model is in the device's favorites. */
export function isFavoriteModel(
  favorites: ReadonlyArray<FavoriteModel>,
  option: ModelOption,
): boolean {
  return favorites.some(
    (favorite) =>
      favorite.provider === option.selection.instanceId &&
      favorite.model === option.selection.model,
  );
}

/** Adds a model to the end of the favorites, or removes it when already present. */
export function toggleFavoriteModel(
  favorites: ReadonlyArray<FavoriteModel>,
  option: ModelOption,
): ReadonlyArray<FavoriteModel> {
  return isFavoriteModel(favorites, option)
    ? favorites.filter(
        (favorite) =>
          favorite.provider !== option.selection.instanceId ||
          favorite.model !== option.selection.model,
      )
    : [...favorites, { provider: option.selection.instanceId, model: option.selection.model }];
}

/**
 * Favorites that exist in the current catalog, in the order they were added.
 * Favorites for providers this environment does not have are skipped, not dropped.
 */
export function favoriteModelOptions(
  groups: ReadonlyArray<ProviderGroup>,
  favorites: ReadonlyArray<FavoriteModel>,
): ReadonlyArray<ModelOption> {
  return favorites.flatMap((favorite) => {
    for (const group of groups) {
      const option = group.models.find(
        (model) =>
          model.selection.instanceId === favorite.provider &&
          model.selection.model === favorite.model,
      );
      if (option) return [option];
    }
    return [];
  });
}
