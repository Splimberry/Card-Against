const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const appSource = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");

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

mutationRuleIds.forEach((id) => {
  assert.match(appSource, new RegExp(`id: "${id}"`), `Mutation registry is missing ${id}`);
});

assert.match(
  appSource,
  /`Mutation: \$\{definition\.name\}`/,
  "Mutation status definitions must be included in the status viewer"
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
