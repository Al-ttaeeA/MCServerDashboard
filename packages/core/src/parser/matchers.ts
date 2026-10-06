import { matchDeathMessage } from "./death-messages";
import type { LogEvent, LogLine } from "./types";

/**
 * A matcher recognizes one kind of log message.
 *
 * Returns:
 * - a `LogEvent` when the line is something we track,
 * - `"ignore"` when the line is recognized but carries nothing we store,
 * - `null` when it doesn't apply (the next matcher is tried).
 *
 * To support a new message (or a changed format after a Minecraft update),
 * add a matcher to `MATCHERS`. Order matters: the first non-null result wins.
 */
export interface Matcher {
  id: string;
  match(message: string, line: LogLine, ctx: MatchContext): LogEvent | "ignore" | null;
}

export interface MatchContext {
  /** Names seen in `UUID of player …` lines (or preloaded from the DB). */
  knownPlayers: ReadonlySet<string>;
}

/** Minecraft 26.x prefixes broadcast messages with `System chat: `; older versions don't. */
const SYSTEM_CHAT_PREFIX = "System chat: ";

export function stripSystemChat(message: string): { text: string; isSystemChat: boolean } {
  return message.startsWith(SYSTEM_CHAT_PREFIX)
    ? { text: message.slice(SYSTEM_CHAT_PREFIX.length), isSystemChat: true }
    : { text: message, isSystemChat: false };
}

const PLAYER_NAME = /^[A-Za-z0-9_]{1,16}$/;
const isPlayerName = (s: string) => PLAYER_NAME.test(s);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Splits `"<name><suffix>"`, returning the name if the message ends with `suffix`. */
function nameBefore(text: string, suffix: string): string | null {
  if (!text.endsWith(suffix)) return null;
  const name = text.slice(0, -suffix.length);
  return isPlayerName(name) ? name : null;
}

/**
 * Per-message features for chat-style statistics. Computed here so the text
 * never leaves the parser.
 */
export function chatFeatures(message: string): { length: number; capsShare: number | null; hash: string } {
  const letters = message.match(/\p{L}/gu) ?? [];
  const upper = letters.filter((c) => c !== c.toLowerCase()).length;
  return {
    length: [...message].length,
    capsShare: letters.length >= 4 ? Math.round((upper / letters.length) * 1000) / 1000 : null,
    hash: fnv1a(message.toLowerCase().replace(/\s+/g, " ").trim()),
  };
}

/** 32-bit FNV-1a → 8 hex chars. Collisions are fine (it only spots repeats). */
function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

export const MATCHERS: readonly Matcher[] = [
  {
    id: "server_start",
    match(msg) {
      const p = "Starting minecraft server version ";
      return msg.startsWith(p) ? { type: "SERVER_START", version: msg.slice(p.length).trim() } : null;
    },
  },
  {
    id: "server_ready",
    match(msg) {
      // Done (2.591s)! For help, type "help"
      const m = /^Done \((\d+(?:\.\d+)?)s\)!/.exec(msg);
      return m ? { type: "SERVER_READY", startupSeconds: Number(m[1]) } : null;
    },
  },
  {
    id: "server_stop",
    match(msg) {
      return msg === "Stopping server" ? { type: "SERVER_STOP" } : null;
    },
  },
  {
    id: "server_pause",
    match(msg) {
      return /^Server empty for \d+ seconds, pausing$/.test(msg) ? { type: "SERVER_PAUSE" } : null;
    },
  },
  {
    id: "player_uuid",
    match(msg) {
      // UUID of player Steve is 069a79f4-44e9-4726-a5be-fca90e38aaf5
      const p = "UUID of player ";
      if (!msg.startsWith(p)) return null;
      const rest = msg.slice(p.length);
      const sep = rest.indexOf(" is ");
      if (sep === -1) return null;
      const player = rest.slice(0, sep);
      const uuid = rest.slice(sep + 4).trim().toLowerCase();
      if (!isPlayerName(player) || !UUID_RE.test(uuid)) return null;
      return { type: "PLAYER_UUID", player, uuid };
    },
  },
  {
    id: "player_login",
    match(msg) {
      // Steve[/1.2.3.4:5678] logged in with entity id 25 at (13.5, 97.0, -53.5)
      const marker = "] logged in with entity id ";
      const idx = msg.indexOf(marker);
      if (idx === -1) return null;
      const bracket = msg.indexOf("[");
      if (bracket <= 0 || bracket > idx) return null;
      const player = msg.slice(0, bracket);
      if (!isPlayerName(player)) return null;
      const coords = /at \((-?[\d.]+(?:E-?\d+)?), (-?[\d.]+(?:E-?\d+)?), (-?[\d.]+(?:E-?\d+)?)\)$/.exec(msg);
      if (!coords) return null;
      return {
        type: "PLAYER_LOGIN",
        player,
        x: Number(coords[1]),
        y: Number(coords[2]),
        z: Number(coords[3]),
      };
    },
  },
  {
    id: "disconnect",
    match(msg) {
      // `Steve lost connection: Disconnected` (in-game) vs
      // `Steve (/1.2.3.4:5678) lost connection: …` (never got past login → no session).
      const marker = " lost connection: ";
      const idx = msg.indexOf(marker);
      if (idx === -1) return null;
      const who = msg.slice(0, idx);
      if (isPlayerName(who)) {
        return { type: "DISCONNECT", player: who, reason: msg.slice(idx + marker.length) };
      }
      return "ignore";
    },
  },
  {
    id: "pre_login_kick",
    match(msg) {
      // Disconnecting Steve (/1.2.3.4:5678): You are not white-listed on this server!
      return msg.startsWith("Disconnecting ") ? "ignore" : null;
    },
  },
  {
    id: "admin_feedback",
    match(msg) {
      // Command output broadcast to ops, e.g. `/data get entity`:
      // "Steve has the following entity data: 20.0f". Not a player event.
      const { text } = stripSystemChat(msg);
      return /^[A-Za-z0-9_]{1,16} has the following /.test(text) ? "ignore" : null;
    },
  },
  {
    id: "chat",
    match(msg) {
      // `<Steve> hello` — optionally prefixed with `[Not Secure] ` on servers
      // with unsigned chat. Only the fact that a player chatted is kept.
      const text = msg.startsWith("[Not Secure] ") ? msg.slice(13) : msg;
      if (text[0] !== "<") return null;
      const end = text.indexOf("> ");
      if (end === -1) return null;
      const player = text.slice(1, end);
      if (!isPlayerName(player)) return null;
      return { type: "CHAT", player, ...chatFeatures(text.slice(end + 2)) };
    },
  },
  {
    id: "join",
    match(msg) {
      const { text } = stripSystemChat(msg);
      const plain = nameBefore(text, " joined the game");
      if (plain) return { type: "JOIN", player: plain };
      // Steve (formerly known as OldSteve) joined the game
      const renamed = /^([A-Za-z0-9_]{1,16}) \(formerly known as ([A-Za-z0-9_]{1,16})\) joined the game$/.exec(text);
      if (renamed) return { type: "JOIN", player: renamed[1]!, formerName: renamed[2]! };
      return null;
    },
  },
  {
    id: "leave",
    match(msg) {
      const player = nameBefore(stripSystemChat(msg).text, " left the game");
      return player ? { type: "LEAVE", player } : null;
    },
  },
  {
    id: "advancement",
    match(msg) {
      const { text } = stripSystemChat(msg);
      const m = /^([A-Za-z0-9_]{1,16}) has (made the advancement|completed the challenge|reached the goal) \[(.+)\]$/.exec(text);
      if (!m) return null;
      const kind = m[2] === "made the advancement" ? "task" : m[2] === "completed the challenge" ? "challenge" : "goal";
      return { type: "ADVANCEMENT", player: m[1]!, advancement: m[3]!, kind };
    },
  },
  {
    id: "death",
    match(msg, _line, ctx) {
      const { text } = stripSystemChat(msg);
      const death = matchDeathMessage(text);
      // Guard against false positives (e.g. a system message whose first word
      // happens to look like a name): the victim must be a player we know.
      if (!death || !ctx.knownPlayers.has(death.player)) return null;
      const event: LogEvent = { type: "DEATH", player: death.player, message: text, cause: death.cause };
      if (death.killer !== undefined) event.killer = stripBrackets(death.killer);
      if (death.weapon !== undefined) event.weapon = stripBrackets(death.weapon);
      return event;
    },
  },
];

/** Item names in death messages are rendered as `[Diamond Sword]`. */
function stripBrackets(s: string): string {
  return s.startsWith("[") && s.endsWith("]") ? s.slice(1, -1) : s;
}
