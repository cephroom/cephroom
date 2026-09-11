/**
 * The presence registry.
 *
 * Contract 2: the platform never stores shared content. It brokers
 * connections and nothing else. This module is the whole of what the platform
 * knows about what exists, and it is a Map that dies with the process.
 *
 * It is bend #1 in docs/CONTRACTS.md — a cache of who is online is
 * technically data at rest under Contract 1's wording, and it is permitted
 * because Contract 2's guarantee is meaningless without it. It is bounded
 * hard: RAM only, never written, never logged, keyed by a live lease.
 *
 * Two properties are load-bearing and tested:
 *
 * 1. Nothing here is durable. No file, no database, no external cache.
 * 2. Expiry is *lazy*. An entry whose lease has lapsed is filtered out on
 *    read; there is no sweeper. A contributor's work disappears because the
 *    lease was what made it visible, not because a cleanup job noticed.
 */

/** How long an announcement stays visible without a heartbeat. */
export const LEASE_SECONDS = 15;

export type ItemKind = "column" | "dataset";

export interface ManifestItem {
  id: string;
  title: string;
  kind: ItemKind;
  tags: string[];
  /** Who may read it in full. The node enforces this; we only advertise it. */
  access?: "public" | "member" | "lab";
  summary?: string;
  /** Advertised by the node so a listing can show it. Not a copy of them. */
  openProposals?: number;
}

export interface Announcement {
  /** Pseudonymous subject from the node operator's key. Never an email. */
  sub: string;
  displayName: string;
  /**
   * Where a reader's browser should fetch from.
   *
   * Supplied by the node, never derived from the socket. The platform does
   * not read a client IP anywhere — see Contract 1's logging audit.
   */
  address: string;
  items: ManifestItem[];
}

export interface Presence extends Announcement {
  /** Opaque per-connection id. Changes on every reconnect; means nothing. */
  connectionId: string;
  expiresAt: number;
}

export interface Located {
  presence: Presence;
  item: ManifestItem;
}

export interface RegistryHandle {
  connectionId: string;
  /** Extends the lease. A node calls this on a timer while it is serving. */
  heartbeat(): boolean;
  /** Withdraws immediately. Called on graceful shutdown. */
  close(): void;
}

export interface Registry {
  announce(announcement: Announcement): RegistryHandle;
  heartbeat(connectionId: string): boolean;
  withdraw(connectionId: string): void;
  list(): Presence[];
  find(itemId: string): Located | null;
  search(query: string): Located[];
  size(): number;
}

export function createRegistry(now: () => number = Date.now): Registry {
  const live = new Map<string, Presence>();

  const fresh = (presence: Presence) => presence.expiresAt > now();

  const registry: Registry = {
    announce(announcement) {
      const connectionId = `c_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;

      // A node re-announcing replaces its previous lease rather than
      // accumulating one, so a restart does not double-list its work.
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
        heartbeat: () => registry.heartbeat(connectionId),
        close: () => registry.withdraw(connectionId),
      };
    },

    heartbeat(connectionId) {
      const presence = live.get(connectionId);
      if (!presence || !fresh(presence)) return false;
      presence.expiresAt = now() + LEASE_SECONDS * 1000;
      return true;
    },

    withdraw(connectionId) {
      live.delete(connectionId);
    },

    list() {
      return [...live.values()]
        .filter(fresh)
        .sort((a, b) => a.displayName.localeCompare(b.displayName));
    },

    find(itemId) {
      for (const presence of registry.list()) {
        const item = presence.items.find((candidate) => candidate.id === itemId);
        if (item) return { presence, item };
      }
      return null;
    },

    /**
     * Search is a scan over what is being served right now. There is no index
     * and no history, so a column nobody is serving is not findable — which
     * is the correct behaviour rather than a gap.
     */
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

/**
 * The process-wide registry.
 *
 * A module-level singleton because presence is per-process by definition.
 * Note the deployment consequence, recorded in docs/CONTRACTS.md: this
 * requires a single long-lived instance. Spreading it across serverless
 * invocations would need a shared store, and a shared store is exactly the
 * durable thing the contracts forbid.
 */
const globalForRegistry = globalThis as unknown as {
  __binderyRegistry?: Registry;
};

export function registry(): Registry {
  globalForRegistry.__binderyRegistry ??= createRegistry();
  return globalForRegistry.__binderyRegistry;
}
