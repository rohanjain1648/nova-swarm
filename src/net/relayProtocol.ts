/**
 * Wire format between a browser and the co-op relay (server/). The relay only
 * keeps rooms and forwards messages; it never looks inside `data`. This file
 * has no DOM or Node imports so both sides compile it.
 *
 * Binary frames are reserved for host -> clients world snapshots: the relay
 * copies a host's binary frame to every connected client and drops binary
 * from anyone else.
 */

/** Room-code characters: no O/0/I/1, so a code read aloud can't be misheard. */
export const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const CODE_LENGTH = 4;
export const MAX_PLAYERS = 4;
export const RECONNECT_GRACE_MS = 10_000;
export const MAX_NAME_LENGTH = 12;

/** Trim + uppercase a typed code; null unless it's exactly 4 valid characters. */
export function normalizeCode(raw: string): string | null {
  const code = raw.trim().toUpperCase();
  if (code.length !== CODE_LENGTH) return null;
  for (const ch of code) if (!CODE_ALPHABET.includes(ch)) return null;
  return code;
}

export interface RosterEntry {
  slot: number;
  name: string;
  connected: boolean;
}

export type ErrorReason = "not_found" | "full" | "started" | "bad_code" | "bad_token";

export type ClientToRelay =
  | { t: "host"; name: string }
  | { t: "join"; code: string; name: string }
  | { t: "rejoin"; code: string; token: string }
  | { t: "start" }
  | { t: "lobby" }
  /** Host: to one slot, or every client when `to` is omitted. Client: always to the host. */
  | { t: "send"; to?: number; data: unknown };

export type RelayToClient =
  | { t: "welcome"; code: string; slot: number; token: string }
  | { t: "roster"; players: RosterEntry[]; started: boolean }
  | { t: "error"; reason: ErrorReason }
  | { t: "start" }
  | { t: "lobby" }
  | { t: "msg"; from: number; data: unknown }
  | { t: "closed"; reason: "host_left" };
