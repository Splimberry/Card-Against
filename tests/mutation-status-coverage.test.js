const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const appSource = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
const statusViewerStart = appSource.indexOf("function getStatusEffectLibraryEntries()");
const statusViewerEnd = appSource.indexOf("function getMutationEffectLibraryEntries()");
assert.ok(statusViewerStart >= 0 && statusViewerEnd > statusViewerStart, "Status viewer registry function must exist");
const statusViewerSource = appSource.slice(statusViewerStart, statusViewerEnd);
const statusRegistryStart = appSource.indexOf("const statusEffectLibraryIds");
const statusRegistryEnd = appSource.indexOf("const statusEffectLibraryCopy");
const statusRegistrySource = appSource.slice(statusRegistryStart, statusRegistryEnd);

const mutationRuleIds = [
  "mutation_bounty",
  "mutation_double_jeopardy",
  "mutation_sabotage",
  "mutation_reverse_verdict",
  "mutation_participation",
  "mutation_sin_wrath",
  "mutation_nail_coffin",
  "mutation_communism",
  "mutation_monopoly",
  "mutation_speed_demon",
  "mutation_last_chance",
  "mutation_loose_cannon",
  "mutation_magic_eight",
  "mutation_bribe",
  "mutation_robin_hood",
  "mutation_tax_collector"
];

const permanentMutationIds = [
  "adaptive_metabolism",
  "volatile_genome",
  "apex_mutation",
  "recessive_trait",
  "genetic_drift",
  "status_mimicry",
  "parasitic_growth",
  "viral_spread",
  "mitosis",
  "dominant_gene",
  "degenerative_gene",
  "chimera",
  "evolutionary_comeback",
  "cellular_collapse",
  "mutation_stabilizer",
  "unstable_symbiosis"
];

mutationRuleIds.forEach((id) => {
  assert.match(appSource, new RegExp(`id: "${id}"`), `Mutation registry is missing ${id}`);
});

permanentMutationIds.forEach((id) => {
  assert.match(appSource, new RegExp(`id: "${id}"`), `Permanent Mutation registry is missing ${id}`);
});

assert.match(
  appSource,
  /function applyMutationRoundStart\(/,
  "Legacy per-round random Mutation status generation must remain available"
);
assert.match(
  appSource,
  /if \(!state\.renderingSyncedRoomResume\) \{[\s\S]{0,120}applyMutationRoundStart\(\);/,
  "Legacy Mutation statuses must roll during local round setup"
);

assert.match(
  appSource,
  /function getMutationEffectLibraryEntries\(\)/,
  "Legacy Mutation effects must have their own viewer section"
);
assert.match(
  appSource,
  /const statusEffectLibraryIds = Object\.freeze\(\[/,
  "Status viewer must use an explicit status registry"
);
assert.match(statusRegistrySource, /"target_wipe_status"/, "Target Wipe must be listed as a status");
assert.doesNotMatch(statusRegistrySource, /collapsing_star_status/, "Collapsing Star must remain an ability source, not a status");
assert.doesNotMatch(statusRegistrySource, /mutation_bounty|mutation_blessing/, "Instant Mutation rules must remain outside the status registry");
assert.doesNotMatch(
  statusViewerSource,
  /collapsing_star_status|collapsing_star/,
  "Collapsing Star source ability must not be presented as a status effect"
);
assert.doesNotMatch(
  statusViewerSource,
  /tableEvents/,
  "Table events must not be included in the status effect viewer"
);
assert.match(
  appSource,
  /id: "chaos_glitch_status"[^\n]*triggerOnApply: true/,
  "Chaos Mutation glitches must be consumed when applied"
);
assert.match(
  appSource,
  /id: "target_wipe_status"[\s\S]{0,220}apply: \(owner, rounds, mutationId\)/,
  "Mutation Target Wipe must retain its mutation id"
);

const roundRuleCalls = appSource.match(/^\s+applyMutationRoundRules\(deltas, owners,/gm) || [];
assert.equal(roundRuleCalls.length, 2, "Mutation round rules must run in both scoring paths");

console.log("Mutation status coverage checks passed.");
