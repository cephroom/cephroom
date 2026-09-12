
/**
 * Fifteen seconds, because presence has to expire faster than anyone can treat
 * it as a record - contract 4.
 *
 * This is the number that makes "when they stop, it is gone" true rather than
 * aspirational. A contributor who closes their laptop is off the listing within
 * fifteen seconds whether or not they withdrew cleanly, whether or not the
 * network dropped, and whether or not the platform noticed. Lengthening it to a
 * minute would be invisible in normal use and would quietly turn the registry
 * into a short archive: an item could still be listed most of a minute after
 * the machine serving it had gone.
 *
 * The node heartbeats at a third of this (see node/presence.ts), so the lease
 * tolerates two lost beats before dropping.
 */
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

/**
 * The complete list of what the platform learns from a contributor, and it is
 * short on purpose - contracts 2 and 4.
 *
 * A subject, a name they chose, an address they state, an unparsed payment
 * string, and a manifest of ids and titles. No reader counts, no last-seen, no
 * history, no totals. what-each-side-learns.test.ts asserts the absence of
 * readers, requests, lastSeen, history and count by name, because the tempting
 * additions are all things that would be useful once and then permanent.
 *
 * address is a claim, not a fact the platform verified - see serving.ts.
 */
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

/**
 * Named in PERMITTED_GLOBAL_STATE. Process-global, and this is the exception
 * that has to keep earning its place.
 *
 * What makes it survivable is not that it is small - it is that it forgets
 * without being asked. Every entry carries an expiry, list() filters on it, and
 * nothing here writes to disk or reaches the network, so a restart loses
 * exactly the thing that should be lost. no-user-data.test.ts proves the
 * forgetting on a fake clock rather than trusting the lease to be honoured.
 *
 * announce() drops any previous presence for the same subject before adding the
 * new one, so a contributor reconnecting cannot accumulate ghost entries -
 * which would be an archive assembled one dropped connection at a time.
 *
 * The clock is injectable only so expiry can be tested without sleeping.
 */
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
