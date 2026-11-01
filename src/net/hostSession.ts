import { isArchetypeId, type ArchetypeId } from "../game/archetypes";
import { COOP } from "../game/config";
import { IDLE_INPUT, type PlayerInput } from "../game/types";
import { toCard, type Upgrade, type UpgradeCard } from "../game/upgrades";
import type { SlotInfo, World } from "../game/world";
import type { ClientToHost, HostToClient, OverInfo, Wire } from "./gameProtocol";
import type { RosterEntry } from "./relayProtocol";
import { captureSnapshot, encodeSnapshot } from "./snapshot";

interface Huddle {
  round: number;
  /** Rolled upgrades per slot; a pick's index refers into these. */
  choices: Map<number, Upgrade[]>;
  cards: Map<number, UpgradeCard[]>;
  waiting: Set<number>;
  elapsed: number;
}

/**
 * The host's side of a co-op run. Runs the authoritative World, folds in
 * remote players' poses/picks/pings, runs the level-up "huddle", and streams
 * snapshots to clients at COOP.snapshotHz (measured in sim time).
 */
export class HostSession {
  private seq = 0;
  private snapAcc = 0;
  private round = 0;
  private open: Huddle | null = null;
  private inputs: PlayerInput[] = [];
  /** Robot classes announced by joiners, by slot. */
  private readonly classes = new Map<number, ArchetypeId>();
  overInfo: OverInfo | null = null;

  constructor(
    private readonly world: World,
    private readonly wire: Wire,
  ) {}

  start(slots: SlotInfo[]): void {
    const w = this.world;
    slots = slots.map((s) => ({ ...s, archetype: s.archetype ?? this.classes.get(s.slot) }));
    w.reset(slots);
    w.localSlot = 0;
    w.recordEffects = true;
    for (const p of w.players) p.remote = p.slot !== 0;
    this.inputs = w.players.map(() => IDLE_INPUT);
    this.seq = 0;
    this.snapAcc = 0;
    this.round = 0;
    this.open = null;
    this.overInfo = null;
    this.sendGame({ k: "start", slots });
  }

  /** Everyone back to the lobby after a run (the relay unlocks joins again). */
  backToLobby(): void {
    this.wire.send({ t: "lobby" });
    this.sendGame({ k: "lobby" });
  }

  step(dt: number, localInput: PlayerInput): void {
    const w = this.world;
    if (w.gameOver) {
      if (!this.overInfo) this.sendOver();
      return;
    }

    if (this.open) {
      this.open.elapsed += dt;
      if (this.open.elapsed >= COOP.huddleTimeoutSec) {
        for (const slot of [...this.open.waiting]) this.pick(slot, this.open.round, 0);
      }
    }
    if (!this.open && w.pendingLevelUps > 0) this.openHuddle();

    if (!this.open) {
      this.inputs[0] = localInput;
      w.update(dt, this.inputs);
      if (w.gameOver) {
        this.sendSnapshot();
        this.sendOver();
        return;
      }
      if (w.pendingLevelUps > 0) this.openHuddle();
    }

    this.snapAcc += dt;
    const period = 1 / COOP.snapshotHz;
    if (this.snapAcc >= period) {
      this.snapAcc -= period;
      this.sendSnapshot();
    }
  }

  onClientMessage(from: number, m: ClientToHost): void {
    if (m.k === "pose") this.world.setRemotePose(from, m.x, m.y, m.facing, m.firing);
    else if (m.k === "pick") this.pick(from, m.round, m.index);
    else if (m.k === "ping") this.world.addPing(from);
    else if (m.k === "hello" && isArchetypeId(m.archetype)) this.classes.set(from, m.archetype);
  }

  /** Relay roster changed: a disconnected player idles; a removed one leaves the run. */
  onRoster(players: RosterEntry[]): void {
    // A freed slot may be taken by someone else, who brings their own class (or none).
    for (const slot of this.classes.keys()) {
      if (!players.some((r) => r.slot === slot)) this.classes.delete(slot);
    }
    for (const p of this.world.players) {
      if (p.slot === 0 || !p.active) continue;
      const entry = players.find((r) => r.slot === p.slot);
      if (!entry) {
        this.world.removePlayer(p.slot);
        if (this.open) {
          this.open.waiting.delete(p.slot);
          this.closeHuddleIfDone();
        }
      } else if (!entry.connected) {
        p.remoteFiring = false;
      }
    }
  }

  pickLocal(index: number): void {
    if (this.open) this.pick(0, this.open.round, index);
  }

  /** The host's own level-up view, or null when no huddle is open. */
  get huddle(): { round: number; cards: UpgradeCard[]; waiting: number[] } | null {
    if (!this.open) return null;
    return {
      round: this.open.round,
      cards: this.open.waiting.has(0) ? this.open.cards.get(0) ?? [] : [],
      waiting: [...this.open.waiting].sort((a, b) => a - b),
    };
  }

  // ---- Internals ------------------------------------------------------------
  private openHuddle(): void {
    const w = this.world;
    const h: Huddle = { round: ++this.round, choices: new Map(), cards: new Map(), waiting: new Set(), elapsed: 0 };
    for (const p of w.players) {
      if (!p.active) continue;
      const ups = w.rollUpgradeChoices(p.slot);
      const cards = ups.map((u) => toCard(u, p));
      h.choices.set(p.slot, ups);
      h.cards.set(p.slot, cards);
      h.waiting.add(p.slot);
      if (p.slot !== 0) this.sendGame({ k: "cards", round: h.round, cards }, p.slot);
    }
    this.open = h;
    this.sendSnapshot();
  }

  private pick(slot: number, round: number, index: number): void {
    const h = this.open;
    if (!h || h.round !== round || !h.waiting.has(slot)) return;
    const ups = h.choices.get(slot) ?? [];
    const u = ups[index] ?? ups[0];
    if (u) this.world.applyUpgrade(slot, u);
    h.waiting.delete(slot);
    this.closeHuddleIfDone();
  }

  private closeHuddleIfDone(): void {
    const h = this.open;
    if (!h) return;
    for (const slot of h.waiting) if (!this.world.players[slot]?.active) h.waiting.delete(slot);
    if (h.waiting.size > 0) return;
    this.world.finishLevelUp();
    this.open = null;
    this.sendSnapshot();
  }

  private waitingMask(): number {
    let m = 0;
    if (this.open) for (const s of this.open.waiting) m |= 1 << s;
    return m;
  }

  private sendSnapshot(): void {
    const w = this.world;
    const snap = captureSnapshot(w, ++this.seq, this.waitingMask(), w.drainEffects());
    this.wire.sendBinary(encodeSnapshot(snap));
  }

  private sendOver(): void {
    const w = this.world;
    this.overInfo = {
      k: "over",
      time: w.time,
      kills: w.kills,
      level: w.level,
      perPlayer: w.players.filter((p) => p.active).map((p) => ({ slot: p.slot, name: p.name, kills: p.kills })),
    };
    this.sendGame(this.overInfo);
  }

  private sendGame(data: HostToClient, to?: number): void {
    this.wire.send(to === undefined ? { t: "send", data } : { t: "send", to, data });
  }
}
