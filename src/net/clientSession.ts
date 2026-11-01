import { COOP } from "../game/config";
import type { Effect } from "../game/effects";
import type { PlayerInput } from "../game/types";
import type { UpgradeCard } from "../game/upgrades";
import type { World } from "../game/world";
import type { ClientToHost, HostToClient, OverInfo, Wire } from "./gameProtocol";
import { applySnapshot, decodeSnapshot, type Snapshot } from "./snapshot";

interface Buffered {
  s: Snapshot;
  /** Local receive time (ms). */
  at: number;
}

/**
 * A co-op client's side of a run. Never simulates the world: it predicts only
 * its own robot (same movement code as the host), sends that pose ~30x/s, and
 * renders everything else from host snapshots, interpolated
 * COOP.interpDelayMs in the past so motion stays smooth between them.
 */
export class ClientSession {
  private buf: Buffered[] = [];
  private pendingFx: Effect[] = [];
  private poseAcc = 0;
  private running = false;
  private lastSnapAt = 0;
  private _cards: { round: number; cards: UpgradeCard[] } | null = null;
  overInfo: OverInfo | null = null;

  constructor(
    private readonly world: World,
    private readonly wire: Wire,
    private readonly localSlot: number,
    private readonly now: () => number = () => performance.now(),
  ) {
    world.localSlot = localSlot;
  }

  onHostMessage(m: HostToClient): void {
    if (m.k === "start") {
      this.world.reset(m.slots);
      this.world.localSlot = this.localSlot;
      this.buf = [];
      this.pendingFx = [];
      this._cards = null;
      this.overInfo = null;
      this.running = true;
      this.lastSnapAt = this.now();
    } else if (m.k === "cards") {
      this._cards = { round: m.round, cards: m.cards };
    } else if (m.k === "over") {
      this.overInfo = m;
    } else if (m.k === "lobby") {
      this.running = false;
    }
  }

  onSnapshot(data: ArrayBuffer): void {
    if (!this.running) return;
    const s = decodeSnapshot(data);
    const last = this.buf[this.buf.length - 1];
    if (last && s.seq <= last.s.seq) return;
    this.buf.push({ s, at: this.now() });
    this.lastSnapAt = this.now();
    this.pendingFx.push(...s.effects);
    // The host auto-picked for us (timeout) or the huddle closed.
    if (this._cards && (s.waitingMask & (1 << this.localSlot)) === 0) this._cards = null;
  }

  /** One fixed tick: predict our own robot and send its pose. */
  step(dt: number, input: PlayerInput): void {
    const w = this.world;
    if (!this.running || w.gameOver) return;
    const p = w.player;
    if (p.active && !p.downed && !this.huddleOpen) w.stepPlayerMovement(p, input, dt);

    this.poseAcc += dt;
    const period = 1 / COOP.poseHz;
    if (this.poseAcc >= period) {
      this.poseAcc -= period;
      this.sendGame({ k: "pose", x: p.x, y: p.y, facing: p.facing, firing: input.firing && !p.downed });
    }
  }

  /** One render frame: interpolate snapshots into the view World and replay effects. */
  frame(rdt: number): void {
    const w = this.world;
    if (this.buf.length > 0) {
      const renderAt = this.now() - COOP.interpDelayMs;
      let ai = 0;
      for (let i = 0; i < this.buf.length; i++) if (this.buf[i].at <= renderAt) ai = i;
      const a = this.buf[ai];
      const b = this.buf[ai + 1] ?? a;
      const t = b === a ? 1 : Math.min(1, Math.max(0, (renderAt - a.at) / (b.at - a.at)));
      applySnapshot(w, a.s, b.s, t, this.localSlot);
      if (ai > 0) this.buf.splice(0, ai);
    }
    for (const ev of this.pendingFx) w.applyEffect(ev);
    this.pendingFx.length = 0;
    w.tickCosmetics(rdt);
  }

  pick(index: number): void {
    if (!this._cards) return;
    this.sendGame({ k: "pick", round: this._cards.round, index });
    this._cards = null;
  }

  ping(): void {
    this.sendGame({ k: "ping" });
  }

  /** Our level-up cards while we still owe a pick. */
  get cards(): { round: number; cards: UpgradeCard[] } | null {
    return this._cards;
  }

  /** Slots still picking in the open huddle (empty when none). */
  get waiting(): number[] {
    const mask = this.latest?.waitingMask ?? 0;
    const out: number[] = [];
    for (let s = 0; s < COOP.maxPlayers; s++) if (mask & (1 << s)) out.push(s);
    return out;
  }

  get huddleOpen(): boolean {
    return (this.latest?.waitingMask ?? 0) !== 0;
  }

  /** No snapshot for a while mid-run: the host's tab is likely in the background. */
  get hostPaused(): boolean {
    return this.running && !this.world.gameOver && this.now() - this.lastSnapAt > COOP.hostPausedMs;
  }

  get isRunning(): boolean {
    return this.running;
  }

  private get latest(): Snapshot | undefined {
    return this.buf[this.buf.length - 1]?.s;
  }

  private sendGame(data: ClientToHost): void {
    this.wire.send({ t: "send", data });
  }
}
