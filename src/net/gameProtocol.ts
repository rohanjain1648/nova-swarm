import type { UpgradeCard } from "../game/upgrades";
import type { SlotInfo } from "../game/world";
import type { ClientToRelay } from "./relayProtocol";

/**
 * Game messages between the host and its clients. They ride inside the
 * relay's `{t:"send"}` / `{t:"msg"}` envelope; world state itself goes as
 * binary snapshots (see snapshot.ts).
 */
export type ClientToHost =
  | { k: "pose"; x: number; y: number; facing: number; firing: boolean }
  | { k: "pick"; round: number; index: number }
  | { k: "ping" }
  /** Sent after joining: this player's robot class (app players only). */
  | { k: "hello"; archetype: string };

export interface OverInfo {
  k: "over";
  time: number;
  kills: number;
  level: number;
  perPlayer: { slot: number; name: string; kills: number }[];
}

export type HostToClient =
  | { k: "start"; slots: SlotInfo[] }
  | { k: "cards"; round: number; cards: UpgradeCard[] }
  | OverInfo
  | { k: "lobby" };

/** The slice of RelayClient a session needs (lets tests use a fake). */
export interface Wire {
  send(m: ClientToRelay): void;
  sendBinary(b: Uint8Array): void;
}
