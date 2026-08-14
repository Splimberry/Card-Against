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
  const getMutationStatusRemaining = () => 0;
  const isChaosMegaHackActive = () => false;
  const hasImpendingDoom = () => false;
  const hasDoomShield = () => false;
  const hasExplosiveDoom = () => false;
  const getSecretAgentPendingSwapRounds = () => [];
  const isMatchModifierEnabled = () => false;
  const getPermanentMutations = () => [];
  const getPermanentMutationDefinition = () => null;
  const getPermanentMutationState = () => ({ symbiosisTargets: {} });
  const isMutationStatusEligible = () => false;
  const statusEffectLibraryCopy = {};
  const getMutationStatusesAffectingOwner = () => [];
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

console.log("Active effect registry checks passed.");
