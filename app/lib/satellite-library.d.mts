export type StoredSatellite = {
  norad: string;
  name: string;
  group: string;
};

export type FavoriteSatellite = StoredSatellite & {
  addedAt: number;
};

export type RecentSatellite = StoredSatellite & {
  viewedAt: number;
};

export type LibraryStorage = Pick<Storage, "getItem" | "setItem">;

export const FAVORITES_STORAGE_KEY: string;
export function readFavorites(storage: LibraryStorage): FavoriteSatellite[];
export function isFavorite(favorites: FavoriteSatellite[], norad: string): boolean;
export function addFavorite(
  storage: LibraryStorage,
  satellite: StoredSatellite,
  addedAt?: number,
): FavoriteSatellite[];
export function removeFavorite(storage: LibraryStorage, norad: string): FavoriteSatellite[];
export function readRecent(storage: LibraryStorage): RecentSatellite[];
export function addRecent(
  storage: LibraryStorage,
  satellite: StoredSatellite,
  viewedAt?: number,
): RecentSatellite[];
export function clearRecent(storage: LibraryStorage): RecentSatellite[];
