import type { Player } from "./player";
import type { RNG } from "../core/math";
import { PALETTE } from "./config";

/**
 * Roguelite upgrade pool. Each pick either unlocks/levels a weapon or bumps a
 * stat. `max` caps how many times an upgrade can be taken; `eligible` gates
 * weapon-unlock upgrades so they only appear when relevant.
 */
export interface Upgrade {
  id: string;
  name: string;
  color: string;
  icon: string; // single glyph for the card
  max: number;
  weight: number;
  desc: (p: Player) => string;
  eligible?: (p: Player, taken: Record<string, number>) => boolean;
  apply: (p: Player) => void;
}

export const UPGRADES: Upgrade[] = [
  {
    id: "blaster",
    name: "Blaster Mk+",
    color: PALETTE.bullet,
    icon: "➤",
    max: 8,
    weight: 10,
    desc: () => "Faster fire, more damage. Every 3rd level adds a projectile.",
    apply: (p) => { p.blaster++; },
  },
  {
    id: "orbital_unlock",
    name: "Orbital Shards",
    color: PALETTE.orbital,
    icon: "◉",
    max: 1,
    weight: 8,
    desc: () => "NEW WEAPON: crystals orbit you, shredding anything they touch.",
    eligible: (p) => p.orbital === 0,
    apply: (p) => { p.orbital = 1; },
  },
  {
    id: "orbital",
    name: "More Shards",
    color: PALETTE.orbital,
    icon: "◉",
    max: 6,
    weight: 7,
    desc: () => "+1 orbiting shard, more damage and reach.",
    eligible: (p) => p.orbital >= 1,
    apply: (p) => { p.orbital++; },
  },
  {
    id: "nova_unlock",
    name: "Pulse Nova",
    color: PALETTE.nova,
    icon: "◎",
    max: 1,
    weight: 8,
    desc: () => "NEW WEAPON: periodic shockwave that damages and knocks back.",
    eligible: (p) => p.nova === 0,
    apply: (p) => { p.nova = 1; },
  },
  {
    id: "nova",
    name: "Bigger Nova",
    color: PALETTE.nova,
    icon: "◎",
    max: 6,
    weight: 7,
    desc: () => "Wider, harder, more frequent pulse.",
    eligible: (p) => p.nova >= 1,
    apply: (p) => { p.nova++; },
  },
  {
    id: "damage",
    name: "Overcharge",
    color: "#ff8a5a",
    icon: "✦",
    max: 6,
    weight: 8,
    desc: () => "+18% damage to all weapons.",
    apply: (p) => { p.damageMul += 0.18; },
  },
  {
    id: "firerate",
    name: "Rapid Coils",
    color: "#ffd24d",
    icon: "⚡",
    max: 6,
    weight: 8,
    desc: () => "+15% fire rate.",
    apply: (p) => { p.fireRateMul += 0.15; },
  },
  {
    id: "multishot",
    name: "Split Barrel",
    color: PALETTE.bullet,
    icon: "☷",
    max: 4,
    weight: 5,
    desc: () => "+1 blaster projectile per volley.",
    apply: (p) => { p.projectileCount++; },
  },
  {
    id: "pierce",
    name: "Railshot",
    color: "#9ad7ff",
    icon: "→",
    max: 4,
    weight: 5,
    desc: () => "Blaster shots pierce +1 enemy.",
    apply: (p) => { p.pierceBonus++; },
  },
  {
    id: "crit",
    name: "Focus Lens",
    color: "#ff5a5a",
    icon: "✹",
    max: 5,
    weight: 5,
    desc: () => "+8% critical chance (2× damage).",
    apply: (p) => { p.critChance = Math.min(0.75, p.critChance + 0.08); },
  },
  {
    id: "maxhp",
    name: "Reinforced Hull",
    color: "#6bff9d",
    icon: "♥",
    max: 6,
    weight: 7,
    desc: () => "+25 max HP and heal 25.",
    apply: (p) => { p.maxHp += 25; p.hp = Math.min(p.maxHp, p.hp + 25); },
  },
  {
    id: "regen",
    name: "Nanorepair",
    color: "#6bffcf",
    icon: "✚",
    max: 5,
    weight: 5,
    desc: () => "Regenerate +0.8 HP/sec.",
    apply: (p) => { p.regen += 0.8; },
  },
  {
    id: "armor",
    name: "Plating",
    color: "#b8c6ff",
    icon: "▣",
    max: 5,
    weight: 5,
    desc: () => "-2 damage taken per hit.",
    apply: (p) => { p.armor += 2; },
  },
  {
    id: "speed",
    name: "Thrusters",
    color: PALETTE.player,
    icon: "»",
    max: 5,
    weight: 6,
    desc: () => "+10% move speed.",
    apply: (p) => { p.speed *= 1.1; },
  },
  {
    id: "magnet",
    name: "Magnet Core",
    color: PALETTE.xp,
    icon: "◈",
    max: 5,
    weight: 6,
    desc: () => "+40% XP pickup radius.",
    apply: (p) => { p.pickupRadius *= 1.4; },
  },
  {
    id: "xp",
    name: "Neural Boost",
    color: "#c98dff",
    icon: "▲",
    max: 5,
    weight: 5,
    desc: () => "+20% XP gained.",
    apply: (p) => { p.xpMul += 0.2; },
  },
];

const upgradeLevel = (u: Upgrade, p: Player, taken: Record<string, number>): number => {
  if (u.id === "blaster") return p.blaster;
  if (u.id === "orbital") return p.orbital;
  if (u.id === "nova") return p.nova;
  return taken[u.id] ?? 0;
};

/** Pick `count` distinct eligible upgrades, weighted by rarity. */
export function rollUpgrades(
  p: Player,
  taken: Record<string, number>,
  rng: RNG,
  count = 3,
): Upgrade[] {
  const pool = UPGRADES.filter((u) => {
    if (upgradeLevel(u, p, taken) >= u.max) return false;
    if (u.eligible && !u.eligible(p, taken)) return false;
    return true;
  });

  const chosen: Upgrade[] = [];
  const working = pool.slice();
  while (chosen.length < count && working.length > 0) {
    let total = 0;
    for (const u of working) total += u.weight;
    let r = rng.next() * total;
    let idx = 0;
    for (let i = 0; i < working.length; i++) {
      r -= working[i].weight;
      if (r <= 0) { idx = i; break; }
    }
    chosen.push(working[idx]);
    working.splice(idx, 1);
  }
  return chosen;
}

/** Display level label for a card, e.g. "Lv 3 → 4" or "NEW". */
export function upgradeLabel(u: Upgrade, p: Player, taken: Record<string, number>): string {
  const lvl = upgradeLevel(u, p, taken);
  if (u.id.endsWith("_unlock")) return "NEW";
  if (u.max === 1) return "";
  return `Lv ${lvl} → ${lvl + 1}`;
}
