
export const LEASE_SECONDS = 15;

export type ItemKind = "column" | "dataset";

export interface ManifestItem {
  id: string;
  title: string;
  kind: ItemKind;
  tags: string[];
  summary?: string;
  openProposals?: number;
}

export interface Announcement {
  sub: string;
  displayName: string;
  payTo?: string;
  address: string;
  items: ManifestItem[];
}

export interface Presence extends Announcement {
  connectionId: string;
  expiresAt: number;
}

export interface Located {
  presence: Presence;
  item: ManifestItem;
}

export interface RegistryHandle {
  connectionId: string;
  heartbeat(): boolean;
  close(): void;
}

export interface Registry {
  announce(announcement: Announcement): RegistryHandle;
  heartbeat(connectionId: string, sub: string): boolean;
  withdraw(connectionId: string, sub: string): boolean;
  list(): Presence[];
  find(sub: string, itemId: string): Located | null;
  search(query: string): Located[];
  size(): number;
}

export function createRegistry(now: () => number = Date.now): Registry {
  const live = new Map<string, Presence>();

  const fresh = (presence: Presence) => presence.expiresAt > now();

  const registry: Registry = {
    announce(announcement) {
      const connectionId = `c_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;

      for (const [id, presence] of live) {
        if (presence.sub === announcement.sub) live.delete(id);
      }

      live.set(connectionId, {
        ...announcement,
        connectionId,
        expiresAt: now() + LEASE_SECONDS * 1000,
      });

      return {
        connectionId,
        heartbeat: () => registry.heartbeat(connectionId, announcement.sub),
        close: () => registry.withdraw(connectionId, announcement.sub),
      };
    },

    heartbeat(connectionId, sub) {
      const presence = live.get(connectionId);
      if (!presence || presence.sub !== sub || !fresh(presence)) return false;
      presence.expiresAt = now() + LEASE_SECONDS * 1000;
      return true;
    },

    withdraw(connectionId, sub) {
      const presence = live.get(connectionId);
      if (!presence || presence.sub !== sub) return false;
      live.delete(connectionId);
      return true;
    },

    list() {
      return [...live.values()]
        .filter(fresh)
        .sort((a, b) => a.displayName.localeCompare(b.displayName));
    },

    find(sub, itemId) {
      for (const presence of registry.list()) {
        if (presence.sub !== sub) continue;
        const item = presence.items.find((candidate) => candidate.id === itemId);
        if (item) return { presence, item };
      }
      return null;
    },

    search(query) {
      const needle = query.trim().toLowerCase();
      const out: Located[] = [];

      for (const presence of registry.list()) {
        for (const item of presence.items) {
          if (needle.length === 0) {
            out.push({ presence, item });
            continue;
          }
          const haystack = [
            item.title,
            item.summary ?? "",
            presence.displayName,
            ...item.tags,
          ]
            .join(" ")
            .toLowerCase();
          if (haystack.includes(needle)) out.push({ presence, item });
        }
      }

      return out;
    },

    size() {
      return registry.list().length;
    },
  };

  return registry;
}

const globalForRegistry = globalThis as unknown as {
  __cephroomRegistry?: Registry;
};

export function registry(): Registry {
  globalForRegistry.__cephroomRegistry ??= createRegistry();
  return globalForRegistry.__cephroomRegistry;
}
