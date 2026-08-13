const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const appSource = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
const statusViewerStart = appSource.indexOf("function getStatusEffectLibraryEntries()");
const statusViewerEnd = appSource.indexOf("function getPermanentMutationLibraryEntries()");
assert.ok(statusViewerStart >= 0 && statusViewerEnd > statusViewerStart, "Status viewer registry function must exist");
const statusViewerSource = appSource.slice(statusViewerStart, statusViewerEnd);
const statusRegistryStart = appSource.indexOf("const statusEffectLibraryIds");
const statusRegistryEnd = appSource.indexOf("const statusEffectLibraryCopy");
const statusRegistrySource = appSource.slice(statusRegistryStart, statusRegistryEnd);

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

const mutationPowerIds = [
  "mutation_duration_extender",
  "mutation_bug_fix",
  "mutation_catalyst",
  "mutation_potency_amplifier",
  "mutation_evolutionary_leap",
  "mutation_positive_infuser",
  "mutation_negative_extractor",
  "mutation_immunity",
  "mutation_bonus",
  "mutation_broken_test_tube",
  "mutation_contagion",
  "mutation_chain_reaction",
  "mutation_quarantine",
  "mutation_status_inversion",
  "mutation_catalyst_epic",
  "mutation_overclock",
  "mutation_patient_zero",
  "mutation_gamble_mutagen",
  "mutation_sovereign",
  "mutation_ultimate"
];

permanentMutationIds.forEach((id) => {
  assert.match(appSource, new RegExp(`id: "${id}"`), `Permanent Mutation registry is missing ${id}`);
});

const mutationDeckStart = appSource.indexOf("const mutationPowerDeck = Object.freeze([");
const mutationDeckEnd = appSource.indexOf("const powerMap =", mutationDeckStart);
assert.ok(mutationDeckStart >= 0 && mutationDeckEnd > mutationDeckStart, "Mutation power deck must exist");
const mutationDeckSource = appSource.slice(mutationDeckStart, mutationDeckEnd);
assert.equal((mutationDeckSource.match(/mutationPower: true/g) || []).length, 20, "Mutation deck must contain exactly 20 status-focused powers");
mutationPowerIds.forEach((id) => {
  assert.match(mutationDeckSource, new RegExp(`id: "${id}"`), `Mutation power deck is missing ${id}`);
});
assert.match(appSource, /function getActivePowerDeck\(\) \{[\s\S]{0,120}isMutationPowerMatch\(\) \? mutationPowerDeck : powerDeck/, "Mutation matches must select the dedicated Mutation deck");
assert.match(appSource, /function setupPowerHands\(\) \{[\s\S]{0,1100}drawPowerHand\(3, getPowerDrawOptions\("player"\)\)[\s\S]{0,180}drawPowerHand\(3, getPowerDrawOptions\("opponent"\)\)/, "Local player and opponent hands must use Mutation-aware draw options");
assert.match(appSource, /function setupPowerHands\(\) \{[\s\S]{0,1500}drawPowerHand\(getPowerHandLimit\(owner\), getPowerDrawOptions\(owner\)\)/, "Local bot hands must use Mutation-aware draw options");
assert.match(appSource, /id: "mutation_bug_fix"[\s\S]{0,240}type: "bug_fix"/, "Bug Fix must use the dedicated status selector type");
assert.match(appSource, /id: "mutation_potency_amplifier"[\s\S]{0,260}type: "potency_amplifier"/, "Potency Amplifier must use the dedicated status selector type");
assert.match(appSource, /if \(power\.mutationPower && \(power\.type === "bug_fix" \|\| power\.type === "potency_amplifier"\)\) \{[\s\S]{0,180}if \(openMutationStatusSelector\(owner, power, powerId\)\) \{[\s\S]{0,80}return;[\s\S]{0,80}\}\s*return;/, "Mutation status selectors must not fall back to generic player targeting");
assert.match(appSource, /function getMutationStatusSelectionId\(status\)[\s\S]{0,220}synthetic:\$\{status\.id\}/, "Inherited status effects need stable selector identifiers");
assert.match(appSource, /function getMutationStatusBySelection\(owner, selectionId\)/, "Mutation selector choices must resolve both rolled and inherited statuses");
assert.match(appSource, /power\?\.mutationPower && \(power\.type === "bug_fix" \|\| power\.type === "potency_amplifier"\)[\s\S]{0,680}getMutationStatusSelectionId\(selectedStatus\)/, "Bots must resolve Mutation status selectors without using player targets");

assert.match(
  appSource,
  /function applyMutationStatusRoundStart\(/,
  "Mutation mode must have a per-round status roll"
);
assert.match(
  appSource,
  /if \(!state\.renderingSyncedRoomResume\) \{[\s\S]{0,120}applyMutationStatusRoundStart\(\);/,
  "Mutation statuses must roll during local round setup"
);
assert.match(
  appSource,
  /function getMutationEligibleStatusDefinitions\(\)/,
  "Mutation mode must use an explicit temporary status eligibility pool"
);
assert.match(
  appSource,
  /const mutationExcludedStatusIds = new Set\(\[/,
  "Mutation-only status exclusions must be explicit"
);
assert.match(
  appSource,
  /function pickWeightedMutationStatus\(definitions, owner\)/,
  "Mutation mode must select status tiers with weighted rarity"
);
assert.match(appSource, /chaos: Math\.min\(0\.7, 0\.2/, "Mutation Chaos odds must start at 20%");
assert.match(appSource, /doom: Math\.min\(0\.2, 0\.025/, "Mutation Doom odds must start at 2.5%");
assert.doesNotMatch(appSource, /currentMutationTableEffect/, "Mutation must not retain a separate table-effect state");
assert.doesNotMatch(appSource, /const mutationTableEffects = Object\.freeze/, "Mutation must not define a table-effect registry");
assert.match(appSource, /function getCurrentTableEvent\(\)[\s\S]{0,220}isMatchModifierEnabled\("mutation"\)[\s\S]{0,80}null/, "Mutation must disable table events");
assert.match(appSource, /currentTableEvent: mutationActive \? null/, "Mutation room snapshots must not serialize table effects");
assert.match(appSource, /state\.currentTableEvent = mutationActive[\s\S]{0,60}\? null/, "Mutation room snapshots must not restore table effects");
assert.match(appSource, /if \(merged\.mutation\) \{[\s\S]{0,60}merged\.partyMayhem = false/, "Mutation settings must disable Party Mayhem");
assert.doesNotMatch(appSource, /pool: "mutation"/, "Obsolete legacy Mutation roll definitions must be removed");
assert.doesNotMatch(appSource, /applyMutationRoundRules|getActiveMutationRuleEntries/, "Obsolete Mutation round-rule path must be removed");
assert.match(appSource, /abilityMutationPreviewToggle/, "Mutation viewer toggle must be wired");
assert.match(
  appSource,
  /const statusEffectLibraryIds = Object\.freeze\(\[/,
  "Status viewer must use an explicit status registry"
);
assert.match(statusRegistrySource, /"target_wipe_status"/, "Target Wipe must be listed as a status");
assert.doesNotMatch(statusRegistrySource, /collapsing_star_status/, "Collapsing Star must remain an ability source, not a status");
assert.doesNotMatch(statusRegistrySource, /mutation_bounty|mutation_blessing/, "Removed legacy Mutation rules must stay outside the status registry");
assert.match(statusRegistrySource, /"doom_shield"/, "Ultimatum must be available in the Mutation status viewer");
assert.match(statusRegistrySource, /"impending_doom"/, "Impending Doom must be available in the Mutation status viewer");
assert.match(statusRegistrySource, /"null_corruption"/, "Null Corruption must be available in the Mutation status viewer");
assert.doesNotMatch(statusRegistrySource, /"time_dilation"/, "Time effects must not be listed in the Mutation status viewer");
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
assert.match(appSource, /deathMarkRounds: 2/, "Mutation Death Bomb must use a two-round Death Mark");
assert.match(appSource, /if \(bomb\.mutation\)/, "Mutation Death Bomb must not use the permanent mark path");
assert.match(appSource, /id: "freeze_ray"[^\n]*mutationName: "Frozen"/, "Mutation Freeze Ray must display as Frozen");
assert.match(appSource, /id: "heaven_hell_curse"[^\n]*mutationName: "Curse"/, "Mutation Heaven/Hell Curse must display as Curse");
assert.match(appSource, /function renderMutationSummary\(\)[\s\S]{0,900}getPermanentMutations\(owner\)/, "Mutation summary must render permanent Mutations");
assert.doesNotMatch(appSource.match(/function renderMutationSummary\(\)[\s\S]{0,1800}/)?.[0] || "", /mutationRoundFeed/, "Mutation summary must not render newly gained Status Effects");
assert.doesNotMatch(appSource.match(/function getMutationStatusBarEntries\(owner = getFocusedOwner\(\)\)[\s\S]{0,2200}/)?.[0] || "", /getPermanentMutations\(owner\)/, "Permanent Mutations must stay out of the status bar");
assert.match(appSource, /queueStatFlash\("mutation", "Mutation Status Roll"/, "Mutation rolls must use Mutation styling");
[
  "permafrost", "eternal_flame", "fire_extinguisher", "eternal_celebration_status",
  "overachiever_status", "debuff_time_bomb", "permanent_death_mark_status", "wrath_bomb_status",
  "useless_software", "skill_issue_status", "mega_hacks_status", "chaos_infuser", "explosive_doom",
  "doom_streak_guard", "ultimatum_bomb_status", "time_accelerator_status", "time_dilation"
].forEach((id) => {
  assert.match(appSource, new RegExp(`"${id}"`), `Mutation exclusion list is missing ${id}`);
});

console.log("Mutation status coverage checks passed.");
