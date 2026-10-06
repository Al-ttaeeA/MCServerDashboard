import type { LogEvent } from "../parser/types";

/**
 * Player identity resolution.
 *
 * Vanilla logs `UUID of player <name> is <uuid>` right before each login
 * (online-mode servers get real Mojang UUIDs). We key players by UUID, so a
 * rename shows up as the same player with a new name.
 *
 * For events that mention a name before any UUID line was seen (should not
 * happen with complete logs), we fall back to a provisional `name:<name>`
 * key that can be reconciled later.
 */

export interface PlayerIdentity {
  key: string;
  uuid: string | null;
  /** Most recently seen name. */
  name: string;
  /** All names in order of first appearance. */
  names: string[];
  firstSeenTs: number;
  lastSeenTs: number;
}

export const provisionalKey = (name: string) => `name:${name.toLowerCase()}`;

export function eventPlayerName(e: LogEvent): string | null {
  return "player" in e ? e.player : null;
}

export interface ResolveInput {
  ts: number;
  event: LogEvent;
}

export interface ResolveResult {
  /** Player key for each input (null for server events). Same order as input. */
  keys: (string | null)[];
  players: Map<string, PlayerIdentity>;
}

/**
 * @param knownUuids name → uuid mappings already known (e.g. from the DB),
 *                   used when the log window starts mid-session.
 */
export function resolvePlayers(
  items: readonly ResolveInput[],
  knownUuids: ReadonlyMap<string, string> = new Map(),
): ResolveResult {
  const uuidByName = new Map<string, string>();
  for (const [name, uuid] of knownUuids) uuidByName.set(name.toLowerCase(), uuid);
  const players = new Map<string, PlayerIdentity>();
  const keys: (string | null)[] = [];

  for (const { ts, event } of items) {
    const name = eventPlayerName(event);
    if (name === null) {
      keys.push(null);
      continue;
    }
    if (event.type === "PLAYER_UUID") uuidByName.set(name.toLowerCase(), event.uuid);

    const uuid = uuidByName.get(name.toLowerCase()) ?? null;
    const key = uuid ?? provisionalKey(name);
    keys.push(key);

    // The authenticator logs a UUID for *anyone* who attempts to connect,
    // including people the whitelist then rejects. Only later events (login,
    // join, …) prove someone actually played, so only they create a player.
    if (event.type === "PLAYER_UUID") continue;

    let p = players.get(key);
    if (!p) {
      p = { key, uuid, name, names: [name], firstSeenTs: ts, lastSeenTs: ts };
      players.set(key, p);
    }
    if (!p.names.includes(name)) p.names.push(name);
    p.name = name;
    p.lastSeenTs = Math.max(p.lastSeenTs, ts);
  }

  return { keys, players };
}
