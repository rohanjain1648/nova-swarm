import type { Player } from "./player";

export type ArchetypeId = "vanguard" | "striker" | "recon" | "engineer";

/** Evaluated against Profile in profile.ts; kept here so the archetype that
 * owns a condition and the condition's shape can never drift apart. */
export type UnlockCondition =
  | { kind: "default" }
  | { kind: "totalKills"; count: number }
  | { kind: "survive"; seconds: number }; // longest single-run survival time

export interface Archetype {
  id: ArchetypeId;
  name: string;
  tagline: string;
  icon: string; // single glyph, same convention as Upgrade.icon
  color: string; // hex tint applied to the robot's "Main" material
  scaleMul: number; // multiplies WorldView.robotBaseScale for this archetype
  finish: { metalness: number; roughness: number; emissiveIntensity: number };
  unlock: UnlockCondition;
  /** Mutate a freshly-reset Player with this archetype's stat identity. */
  apply: (p: Player) => void;
}

export const ARCHETYPES: Record<ArchetypeId, Archetype> = {
  vanguard: {
    id: "vanguard",
    name: "Vanguard",
    tagline: "Tanky front-liner. Soaks hits, trades speed for survival.",
    icon: "🛡",
    color: "#3fe9ff",
    scaleMul: 1.15,
    finish: { metalness: 0.75, roughness: 0.35, emissiveIntensity: 0.5 },
    unlock: { kind: "default" },
    apply: (p) => {
      p.maxHp = Math.round(p.maxHp * 1.5);
      p.hp = p.maxHp;
      p.speed *= 0.88;
      p.armor += 4;
    },
  },
  recon: {
    id: "recon",
    name: "Recon",
    tagline: "Fast and fragile. Outrun the swarm, vacuum XP from afar.",
    icon: "⚡",
    color: "#5affa0",
    scaleMul: 0.9,
    finish: { metalness: 0.3, roughness: 0.55, emissiveIntensity: 0.7 },
    unlock: { kind: "survive", seconds: 180 },
    apply: (p) => {
      p.speed *= 1.3;
      p.pickupRadius *= 1.25;
      p.maxHp = Math.round(p.maxHp * 0.8);
      p.hp = p.maxHp;
    },
  },
  striker: {
    id: "striker",
    name: "Striker",
    tagline: "Glass cannon. Hits hard and fast, dies in a few mistakes.",
    icon: "🔥",
    color: "#ff6a3d",
    scaleMul: 0.95,
    finish: { metalness: 0.5, roughness: 0.25, emissiveIntensity: 0.9 },
    unlock: { kind: "totalKills", count: 50 },
    apply: (p) => {
      p.damageMul *= 1.35;
      p.fireRateMul *= 1.15;
      p.maxHp = Math.round(p.maxHp * 0.75);
      p.hp = p.maxHp;
    },
  },
  engineer: {
    id: "engineer",
    name: "Engineer",
    tagline: "Starts with Orbital Shards already deployed.",
    icon: "◉",
    color: "#c07bff",
    scaleMul: 1,
    finish: { metalness: 0.6, roughness: 0.4, emissiveIntensity: 0.6 },
    unlock: { kind: "totalKills", count: 150 },
    apply: (p) => {
      p.orbital = 1;
      p.maxHp = Math.round(p.maxHp * 0.9);
      p.hp = p.maxHp;
    },
  },
};

export const ARCHETYPE_LIST: Archetype[] = [
  ARCHETYPES.vanguard,
  ARCHETYPES.recon,
  ARCHETYPES.striker,
  ARCHETYPES.engineer,
];

/** Guard for a class id arriving over the network (own keys only, so "constructor" isn't a class). */
export const isArchetypeId = (id: unknown): id is ArchetypeId =>
  typeof id === "string" && Object.prototype.hasOwnProperty.call(ARCHETYPES, id);
