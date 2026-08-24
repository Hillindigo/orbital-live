export const FAVORITES_STORAGE_KEY = "orbital-favorites";

function normalizeSatellite(satellite) {
  if (!satellite || typeof satellite !== "object") return null;
  const { norad, name, group } = satellite;
  if (typeof norad !== "string" || !norad.trim()) return null;
  if (typeof name !== "string" || !name.trim()) return null;
  if (typeof group !== "string" || !group.trim()) return null;
  return { norad, name, group };
}

function parseItems(storage, key) {
  try {
    const parsed = JSON.parse(storage.getItem(key) ?? "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeItems(storage, key, items) {
  storage.setItem(key, JSON.stringify(items));
  return items;
}

export function readFavorites(storage) {
  return parseItems(storage, FAVORITES_STORAGE_KEY).flatMap((item) => {
    const satellite = normalizeSatellite(item);
    if (!satellite || typeof item.addedAt !== "number") return [];
    return [{ ...satellite, addedAt: item.addedAt }];
  });
}

export function isFavorite(favorites, norad) {
  return favorites.some((item) => item.norad === norad);
}

export function addFavorite(storage, satellite, addedAt = Date.now()) {
  const normalized = normalizeSatellite(satellite);
  if (!normalized) return readFavorites(storage);
  const current = readFavorites(storage);
  const existing = current.find((item) => item.norad === normalized.norad);
  const next = existing
    ? [{ ...normalized, addedAt: existing.addedAt }, ...current.filter((item) => item.norad !== normalized.norad)]
    : [{ ...normalized, addedAt }, ...current];
  return writeItems(storage, FAVORITES_STORAGE_KEY, next);
}

export function removeFavorite(storage, norad) {
  return writeItems(
    storage,
    FAVORITES_STORAGE_KEY,
    readFavorites(storage).filter((item) => item.norad !== norad),
  );
}
