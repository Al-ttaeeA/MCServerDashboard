/**
 * Vanilla death message catalog (English, `en_us`).
 *
 * The server logs the *translated* English text of every death broadcast,
 * e.g. `Steve was slain by Zombie`. These templates mirror the `death.*`
 * translation keys in the game's language file, where `%1$s` is the victim,
 * `%2$s` the killer (mob, player or custom name) and `%3$s` the item used.
 *
 * Maintenance: when Mojang adds a new damage type, its message shows up as an
 * `unrecognized_player_message` parse issue. Add the template here — no other
 * code needs to change. The `category` groups causes for statistics.
 */

export type DeathCategory =
  | "mob"
  | "player"
  | "fall"
  | "fire"
  | "lava"
  | "drowning"
  | "explosion"
  | "suffocation"
  | "starvation"
  | "freezing"
  | "magic"
  | "void"
  | "projectile"
  | "environment"
  | "other";

interface DeathTemplate {
  key: string;
  template: string;
  category: DeathCategory;
}

const T = (key: string, category: DeathCategory, template: string): DeathTemplate => ({
  key,
  template,
  category,
});

export const DEATH_TEMPLATES: readonly DeathTemplate[] = [
  T("attack.anvil", "environment", "%1$s was squashed by a falling anvil"),
  T("attack.anvil.player", "environment", "%1$s was squashed by a falling anvil while fighting %2$s"),
  T("attack.arrow", "projectile", "%1$s was shot by %2$s"),
  T("attack.arrow.item", "projectile", "%1$s was shot by %2$s using %3$s"),
  T("attack.badRespawnPoint", "explosion", "%1$s was killed by %2$s"),
  T("attack.cactus", "environment", "%1$s was pricked to death"),
  T("attack.cactus.player", "environment", "%1$s walked into a cactus while trying to escape %2$s"),
  T("attack.cramming", "suffocation", "%1$s was squished too much"),
  T("attack.cramming.player", "suffocation", "%1$s was squashed by %2$s"),
  T("attack.dragonBreath", "magic", "%1$s was roasted in dragon's breath"),
  T("attack.dragonBreath.player", "magic", "%1$s was roasted in dragon's breath by %2$s"),
  T("attack.drown", "drowning", "%1$s drowned"),
  T("attack.drown.player", "drowning", "%1$s drowned while trying to escape %2$s"),
  T("attack.dryout", "other", "%1$s died from dehydration"),
  T("attack.dryout.player", "other", "%1$s died from dehydration while trying to escape %2$s"),
  T("attack.even_more_magic", "magic", "%1$s was killed by even more magic"),
  T("attack.explosion", "explosion", "%1$s blew up"),
  T("attack.explosion.player", "explosion", "%1$s was blown up by %2$s"),
  T("attack.explosion.player.item", "explosion", "%1$s was blown up by %2$s using %3$s"),
  T("attack.fall", "fall", "%1$s hit the ground too hard"),
  T("attack.fall.player", "fall", "%1$s hit the ground too hard while trying to escape %2$s"),
  T("attack.fallingBlock", "environment", "%1$s was squashed by a falling block"),
  T("attack.fallingBlock.player", "environment", "%1$s was squashed by a falling block while fighting %2$s"),
  T("attack.fallingStalactite", "environment", "%1$s was skewered by a falling stalactite"),
  T("attack.fallingStalactite.player", "environment", "%1$s was skewered by a falling stalactite while fighting %2$s"),
  T("attack.fireball", "fire", "%1$s was fireballed by %2$s"),
  T("attack.fireball.item", "fire", "%1$s was fireballed by %2$s using %3$s"),
  T("attack.fireworks", "explosion", "%1$s went off with a bang"),
  T("attack.fireworks.player", "explosion", "%1$s went off with a bang while fighting %2$s"),
  T("attack.fireworks.item", "explosion", "%1$s went off with a bang due to a firework fired from %3$s by %2$s"),
  T("attack.flyIntoWall", "fall", "%1$s experienced kinetic energy"),
  T("attack.flyIntoWall.player", "fall", "%1$s experienced kinetic energy while trying to escape %2$s"),
  T("attack.freeze", "freezing", "%1$s froze to death"),
  T("attack.freeze.player", "freezing", "%1$s was frozen to death by %2$s"),
  T("attack.generic", "other", "%1$s died"),
  T("attack.generic.player", "other", "%1$s died because of %2$s"),
  T("attack.genericKill", "other", "%1$s was killed"),
  T("attack.genericKill.player", "other", "%1$s was killed while fighting %2$s"),
  T("attack.hotFloor", "fire", "%1$s discovered the floor was lava"),
  T("attack.hotFloor.player", "fire", "%1$s walked into the danger zone due to %2$s"),
  T("attack.inFire", "fire", "%1$s went up in flames"),
  T("attack.inFire.player", "fire", "%1$s walked into fire while fighting %2$s"),
  T("attack.inWall", "suffocation", "%1$s suffocated in a wall"),
  T("attack.inWall.player", "suffocation", "%1$s suffocated in a wall while fighting %2$s"),
  T("attack.indirectMagic", "magic", "%1$s was killed by %2$s using magic"),
  T("attack.indirectMagic.item", "magic", "%1$s was killed by %2$s using %3$s"),
  T("attack.lava", "lava", "%1$s tried to swim in lava"),
  T("attack.lava.player", "lava", "%1$s tried to swim in lava to escape %2$s"),
  T("attack.lightningBolt", "environment", "%1$s was struck by lightning"),
  T("attack.lightningBolt.player", "environment", "%1$s was struck by lightning while fighting %2$s"),
  T("attack.mace_smash", "mob", "%1$s was smashed by %2$s"),
  T("attack.mace_smash.item", "mob", "%1$s was smashed by %2$s with %3$s"),
  T("attack.magic", "magic", "%1$s was killed by magic"),
  T("attack.magic.player", "magic", "%1$s was killed by magic while trying to escape %2$s"),
  T("attack.mob", "mob", "%1$s was slain by %2$s"),
  T("attack.mob.item", "mob", "%1$s was slain by %2$s using %3$s"),
  T("attack.onFire", "fire", "%1$s burned to death"),
  T("attack.onFire.player", "fire", "%1$s was burned to a crisp while fighting %2$s"),
  T("attack.onFire.item", "fire", "%1$s was burned to a crisp while fighting %2$s wielding %3$s"),
  T("attack.outOfWorld", "void", "%1$s fell out of the world"),
  T("attack.outOfWorld.player", "void", "%1$s didn't want to live in the same world as %2$s"),
  T("attack.outsideBorder", "void", "%1$s left the confines of this world"),
  T("attack.outsideBorder.player", "void", "%1$s left the confines of this world while fighting %2$s"),
  T("attack.sonic_boom", "mob", "%1$s was obliterated by a sonically-charged shriek"),
  T("attack.sonic_boom.player", "mob", "%1$s was obliterated by a sonically-charged shriek while trying to escape %2$s"),
  T("attack.sonic_boom.item", "mob", "%1$s was obliterated by a sonically-charged shriek while trying to escape %2$s wielding %3$s"),
  T("attack.spit", "mob", "%1$s was spat on by %2$s"),
  T("attack.spit.item", "mob", "%1$s was spat on by %2$s using %3$s"),
  T("attack.stalagmite", "environment", "%1$s was impaled on a stalagmite"),
  T("attack.stalagmite.player", "environment", "%1$s was impaled on a stalagmite while fighting %2$s"),
  T("attack.starve", "starvation", "%1$s starved to death"),
  T("attack.starve.player", "starvation", "%1$s starved to death while fighting %2$s"),
  T("attack.sting", "mob", "%1$s was stung to death"),
  T("attack.sting.player", "mob", "%1$s was stung to death by %2$s"),
  T("attack.sting.item", "mob", "%1$s was stung to death by %2$s using %3$s"),
  T("attack.sweetBerryBush", "environment", "%1$s was poked to death by a sweet berry bush"),
  T("attack.sweetBerryBush.player", "environment", "%1$s was poked to death by a sweet berry bush while trying to escape %2$s"),
  T("attack.thorns", "mob", "%1$s was killed while trying to hurt %2$s"),
  T("attack.thorns.item", "mob", "%1$s was killed by %3$s while trying to hurt %2$s"),
  T("attack.thrown", "projectile", "%1$s was pummeled by %2$s"),
  T("attack.thrown.item", "projectile", "%1$s was pummeled by %2$s using %3$s"),
  T("attack.trident", "projectile", "%1$s was impaled by %2$s"),
  T("attack.trident.item", "projectile", "%1$s was impaled by %2$s with %3$s"),
  T("attack.wither", "magic", "%1$s withered away"),
  T("attack.wither.player", "magic", "%1$s withered away while fighting %2$s"),
  T("attack.witherSkull", "projectile", "%1$s was shot by a skull from %2$s"),
  T("attack.witherSkull.item", "projectile", "%1$s was shot by a skull from %2$s using %3$s"),
  T("fell.accident.generic", "fall", "%1$s fell from a high place"),
  T("fell.accident.ladder", "fall", "%1$s fell off a ladder"),
  T("fell.accident.other_climbable", "fall", "%1$s fell while climbing"),
  T("fell.accident.scaffolding", "fall", "%1$s fell off scaffolding"),
  T("fell.accident.twisting_vines", "fall", "%1$s fell off some twisting vines"),
  T("fell.accident.vines", "fall", "%1$s fell off some vines"),
  T("fell.accident.weeping_vines", "fall", "%1$s fell off some weeping vines"),
  T("fell.assist", "fall", "%1$s was doomed to fall by %2$s"),
  T("fell.assist.item", "fall", "%1$s was doomed to fall by %2$s using %3$s"),
  T("fell.finish", "fall", "%1$s fell too far and was finished by %2$s"),
  T("fell.finish.item", "fall", "%1$s fell too far and was finished by %2$s using %3$s"),
  T("fell.killer", "fall", "%1$s was doomed to fall"),
];

const CATEGORY_BY_KEY = new Map(DEATH_TEMPLATES.map((t) => [t.key, t.category]));

export function deathCategory(causeKey: string): DeathCategory {
  return CATEGORY_BY_KEY.get(causeKey) ?? "other";
}

/** Valid Minecraft Java usernames: 3–16 chars of [A-Za-z0-9_]. Logs occasionally show shorter legacy names. */
const NAME = "([A-Za-z0-9_]{1,16})";

interface CompiledTemplate {
  key: string;
  regex: RegExp;
  /** Capture group index for %2$s / %3$s (they can appear in either order). */
  killerGroup: number | null;
  weaponGroup: number | null;
  /** Literal characters in the template — used to try the most specific template first. */
  specificity: number;
}

function compile(t: DeathTemplate): CompiledTemplate {
  const parts = t.template.split(/(%[123]\$s)/);
  let pattern = "^";
  let group = 0;
  let killerGroup: number | null = null;
  let weaponGroup: number | null = null;
  let specificity = 0;
  for (const part of parts) {
    if (part === "%1$s") {
      group++;
      pattern += NAME;
    } else if (part === "%2$s") {
      killerGroup = ++group;
      pattern += "(.+?)";
    } else if (part === "%3$s") {
      weaponGroup = ++group;
      pattern += "(.+?)";
    } else {
      specificity += part.length;
      pattern += escapeRegex(part);
    }
  }
  return { key: t.key, regex: new RegExp(pattern + "$"), killerGroup, weaponGroup, specificity };
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Longest literal text first, so `was slain by X using Y` beats `was slain by X`.
const COMPILED = DEATH_TEMPLATES.map(compile).sort((a, b) => b.specificity - a.specificity);

export interface DeathMatch {
  player: string;
  cause: string;
  killer?: string;
  weapon?: string;
}

/** Matches a broadcast message against the death catalog. */
export function matchDeathMessage(message: string): DeathMatch | null {
  for (const t of COMPILED) {
    const m = t.regex.exec(message);
    if (!m) continue;
    const result: DeathMatch = { player: m[1]!, cause: t.key };
    if (t.killerGroup !== null) result.killer = m[t.killerGroup];
    if (t.weaponGroup !== null) result.weapon = m[t.weaponGroup];
    return result;
  }
  return null;
}
