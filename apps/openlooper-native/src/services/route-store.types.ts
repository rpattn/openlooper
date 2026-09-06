import type { SavedRoute, SavedRoutePage, SavedRouteSummary } from '@/domain/saved-route';

/**
 * Local library of saved routes. SQLite backs it on a device; the web build
 * cannot use the same store, so it has its own implementation of this contract.
 */
export type RouteStore = {
  listRoutes: (offset: number, limit: number) => Promise<SavedRoutePage>;
  loadRoute: (id: string) => Promise<SavedRoute | undefined>;
  /** Inserts or replaces by id and returns the summary the list should show. */
  putRoute: (route: SavedRoute) => Promise<SavedRouteSummary>;
  deleteRoute: (id: string) => Promise<void>;
};
