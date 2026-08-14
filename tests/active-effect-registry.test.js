const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const appSource = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
const registryStart = appSource.indexOf("function createActiveEffect");
const registryEnd = appSource.indexOf("function getStatusBarEntries", registryStart);

assert.ok(registryStart >= 0 && registryEnd > registryStart, "Active-effect registry must exist");

function createRegistryState() {
  return new Proxy({
    round: 2,
    currentOwner: "player",
    timeBombs: [],
    debuffTimeBombs: [],
    deathMarks: [],
    wrathBombs: [],
    ultimatumBombs: [],
    skillIssueMarks: [],
    streakLinks: [],
    deathBombMarks: [],
    soulLinks: [],
    hotPotatoOwners: []
  }, {
    get(target, key) {
      return key in target ? target[key] : {};
    }
  });
}

function getNormalRegistryEntries(state) {
  const getActiveOwners = () => ["player"];
  const getFocusedOwner = () => "player";
  const getEffectStackCount = (value) => typeof value === "number"
    ? value
    : Math.max(0, Number(value?.count || value?.stacks || 0) || 0);
  const getModeEffectStacks = (value) => ({
    normal: getEffectStackCount(value?.normal || value),
    chaos: getEffectStackCount(value?.chaos || 0)
  });
  const getModeEffectTotal = (value) => getModeEffectStacks(value).normal + getModeEffectStacks(value).chaos;
  const getThornReflectPercent = () => 0;
  const getSourceStackInfo = (value) => ({ count: getEffectStackCount(value), sourceOwner: value?.sourceOwner || "" });
  const getMegaHackUses = () => 0;
  const getChaosStatus = () => ({});
  const getMutationStatusEntries = () => [];
  const hasActiveMutationStatus = () => false;
  const getPlayedPowerEntries = () => [];
  const formatStackSuffix = (count) => count > 1 ? ` x${count}` : "";
  const getMutationStatusRemaining = (status) => Math.max(0, Number(status?.rounds) || 0);
  const isChaosMegaHackActive = () => false;
  const hasImpendingDoom = () => false;
  const hasDoomShield = () => false;
  const hasExplosiveDoom = () => false;
  const getSecretAgentPendingSwapRounds = () => [];
  const isMatchModifierEnabled = () => false;
  const getPermanentMutations = () => Array.isArray(state.__permanentMutations) ? state.__permanentMutations : [];
  const getPermanentMutationDefinition = (id) => id === "adaptive_metabolism"
    ? { id, name: "Adaptive Metabolism", powerId: "shield", description: "Test permanent mutation.", category: "normal" }
    : null;
  const getPermanentMutationState = () => ({ symbiosisTargets: {} });
  const isMutationStatusEligible = () => true;
  const statusEffectLibraryCopy = {};
  const getMutationStatusesAffectingOwner = () => Array.isArray(state.__temporaryStatuses) ? state.__temporaryStatuses : [];
  const getOwnerLabel = (owner) => owner === "player" ? "You" : "Table";
  const getScore = () => 0;
  const canPowerBecomeChaosInfused = () => false;
  const getChaosInfusedPowerId = (powerId) => powerId;
  const isChaosInfusedPower = () => false;
  const getPowerById = (powerId) => ({ id: powerId, rarity: "grey" });

  // The registry is intentionally evaluated with most status maps empty.
  // Inactive effect descriptions must never prevent unrelated active effects
  // from reaching the normal status bar.
  eval(appSource.slice(registryStart, registryEnd));
  return getRegularStatusBarEntries("player");
}

const state = createRegistryState();
state.pocketShieldCharges = { player: 1 };
state.hotPotatoCount = 1;
state.hotPotatoOwners = ["player"];

const visibleEntries = getNormalRegistryEntries(state);
const visibleNames = visibleEntries.map((entry) => entry.name);

assert.ok(visibleNames.includes("Pocket Shield x1"), "Personal regular effects must remain visible when unrelated statuses are absent");
assert.ok(visibleNames.includes("Hot Potato x1"), "Table-wide regular effects must remain visible when unrelated statuses are absent");
assert.ok(visibleEntries.every((entry) => entry.statusPill), "Regular effects must enter the shared status-card renderer");

const temporaryStatusState = createRegistryState();
temporaryStatusState.__temporaryStatuses = [{
  id: "hot_potato_status",
  owner: "player",
  targetOwner: "player",
  name: "Hot Potato",
  description: "Triggers when its timer ends.",
  powerId: "hot_potato",
  category: "risk",
  rounds: 2
}];
const temporaryStatusEntries = getNormalRegistryEntries(temporaryStatusState);
assert.ok(
  temporaryStatusEntries.some((entry) => entry.name === "Hot Potato" && entry.statusMeta === "1x | 2 rounds"),
  "Temporary shared statuses must remain visible in regular single-player matches"
);

const permanentMutationState = createRegistryState();
permanentMutationState.__permanentMutations = ["adaptive_metabolism"];
const permanentMutationEntries = getNormalRegistryEntries(permanentMutationState);
assert.ok(
  !permanentMutationEntries.some((entry) => entry.name === "Mutation · Adaptive Metabolism"),
  "Permanent Mutations must remain exclusive to Mutation matches"
);

console.log("Active effect registry checks passed.");
