const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync(require.resolve("../app.js"), "utf8");

function getFunctionSource(name, nextName) {
  const asyncStart = source.indexOf(`async function ${name}`);
  const syncStart = source.indexOf(`function ${name}`);
  const start = asyncStart >= 0 && (syncStart < 0 || asyncStart < syncStart)
    ? asyncStart
    : syncStart;
  const end = source.indexOf(`function ${nextName}`, start);
  assert.ok(start >= 0 && end > start, `${name} should exist before ${nextName}`);
  return source.slice(start, end);
}

function testRoomChannelIsReadyBeforeSubscribeCallback() {
  const functionSource = getFunctionSource("startRoomRealtime", "stopRoomRealtime");
  const state = {
    supabaseClient: {
      channel() {
        return channel;
      }
    },
    realtimeRoomChannel: null,
    realtimeRoomCode: "",
    roomRealtimeStatus: "idle",
    realtimeRoomReady: false,
    roomSettings: { code: "CAI-1234" }
  };
  let subscribed = false;
  const channel = {
    on() {
      return channel;
    },
    subscribe(callback) {
      subscribed = true;
      callback("SUBSCRIBED");
      return channel;
    }
  };
  const context = {
    state,
    handleRealtimeRoomChange() {},
    handleRoomRealtimeStatus(status, currentChannel) {
      if (currentChannel && state.realtimeRoomChannel !== currentChannel) {
        return;
      }
      state.roomRealtimeStatus = status;
      state.realtimeRoomReady = status === "SUBSCRIBED";
    },
    stopRoomRealtime() {},
    recordRoomDiagnosticEvent() {}
  };
  vm.createContext(context);
  vm.runInContext(`${functionSource}\nthis.startRoomRealtime = startRoomRealtime;`, context);

  context.startRoomRealtime("CAI-1234");
  assert.equal(subscribed, true);
  assert.equal(state.realtimeRoomChannel, channel);
  assert.equal(state.realtimeRoomReady, true);
  assert.equal(state.roomRealtimeStatus, "SUBSCRIBED");
}

async function testGuestRoomJoinInitializesRealtimeWithoutAuth() {
  const functionSource = getFunctionSource("ensureRoomRealtimeReady", "stopRoomRealtime");
  const state = {
    supabaseClient: null,
    realtimeRoomChannel: null,
    realtimeRoomCode: "",
    roomSettings: { code: "CAI-1234" }
  };
  let requestedRealtime = null;
  let startedCode = "";
  const context = {
    state,
    ensureSupabaseAuthReady(options) {
      requestedRealtime = options;
      state.supabaseClient = {};
      return Promise.resolve(state.supabaseClient);
    },
    startRoomRealtime(code) {
      startedCode = code;
      state.realtimeRoomChannel = {};
      state.realtimeRoomCode = code;
    },
    console: { warn() {} }
  };
  vm.createContext(context);
  vm.runInContext(`${functionSource}\nthis.ensureRoomRealtimeReady = ensureRoomRealtimeReady;`, context);

  const ready = await context.ensureRoomRealtimeReady("CAI-1234");
  assert.equal(ready, true);
  assert.equal(requestedRealtime.realtime, true);
  assert.equal(requestedRealtime.preserveGuest, true);
  assert.equal(startedCode, "CAI-1234");
}

function testLobbyChannelIsReadyBeforeSubscribeCallback() {
  const functionSource = getFunctionSource("startSupabaseRealtime", "scheduleSupabaseLobbyReconnect");
  const state = {
    supabaseClient: {
      channel() {
        return channel;
      }
    },
    realtimeLobbyChannel: null,
    realtimeLobbyReady: false,
    roomInvite: { active: false },
    roomSettings: { code: "CAI-0000" }
  };
  const channel = {
    on() {
      return channel;
    },
    subscribe(callback) {
      callback("SUBSCRIBED");
      return channel;
    }
  };
  const context = {
    state,
    elements: {
      joinScreen: {
        classList: { contains: () => true }
      }
    },
    hasActiveRoomContext() {
      return false;
    },
    handleRealtimeRoomChange() {},
    refreshHostedRoomsAndRender() {},
    startRoomRealtime() {},
    startRoomPresenceMaintenance() {},
    syncUserQuestionSubmissionPolling() {},
    scheduleSupabaseLobbyReconnect() {}
  };
  vm.createContext(context);
  vm.runInContext(`${functionSource}\nthis.startSupabaseRealtime = startSupabaseRealtime;`, context);

  context.startSupabaseRealtime();
  assert.equal(state.realtimeLobbyChannel, channel);
  assert.equal(state.realtimeLobbyReady, true);
}

function testCompleteAuthoritativePhasePayloadCanRepairMissedRevision() {
  const functionSource = getFunctionSource("isCompleteAuthoritativeRoomPhasePayload", "isOlderRoomRoundEvent");
  const context = {
    normalizeRoomEventType(type) {
      return String(type || "").replaceAll("_", "-");
    }
  };
  vm.createContext(context);
  vm.runInContext(`${functionSource}\nthis.isCompleteAuthoritativeRoomPhasePayload = isCompleteAuthoritativeRoomPhasePayload;`, context);

  const resultPayload = {
    sourceId: "server",
    eventType: "round-result",
    game: {
      status: "grading",
      setup: { id: "question-1" },
      roundResult: { round: 1, cards: ["answer"] }
    }
  };
  assert.equal(context.isCompleteAuthoritativeRoomPhasePayload(resultPayload), true);
  assert.equal(context.isCompleteAuthoritativeRoomPhasePayload({ ...resultPayload, sourceId: "client" }), false);
  assert.equal(context.isCompleteAuthoritativeRoomPhasePayload({
    sourceId: "server",
    eventType: "round-grading",
    game: { status: "grading", setup: { id: "question-1" } }
  }), true);
  assert.equal(context.isCompleteAuthoritativeRoomPhasePayload({
    sourceId: "server",
    eventType: "round-result",
    game: { status: "grading" }
  }), false);
}

function testJoinedClientUsesRoomHostIdentityDuringDuplicateHostMerge() {
  const functionSource = `${getFunctionSource("getRoomSnapshotHostId", "isRoomParticipantBot")}\n${getFunctionSource("isCurrentHost", "getAuthoritativeRoomHostId")}\n${getFunctionSource("getAuthoritativeRoomHostId", "getExpectedRoomCurrentOwner")}`;
  const context = {
    state: {
      clientId: "joined-client",
      roomSettings: { code: "CAI-1234" },
      joiningRoom: {
        code: "CAI-1234",
        host: { id: "host-client" }
      },
      hostedRooms: [],
      roomParticipants: [
        { id: "host-client", role: "host", active: true },
        { id: "joined-client", role: "host", active: true }
      ]
    },
    isRoomParticipantActive(participant) {
      return participant.active !== false;
    },
    isRoomParticipantHost(participant) {
      return participant.role === "host" || participant.host === true;
    }
  };
  vm.createContext(context);
  vm.runInContext(`${functionSource}\nthis.getAuthoritativeRoomHostId = getAuthoritativeRoomHostId;`, context);

  assert.equal(context.getAuthoritativeRoomHostId(), "host-client");
  context.isRoomMode = () => true;
  assert.equal(context.isCurrentHost(), false);
}

function testJoinedGradingWaitUsesJoinedOwner() {
  const gradingSource = getFunctionSource("applyRealtimeRoomGrading", "forceRoomRoundToGrading");
  const resolveSource = getFunctionSource("resolveRoomSubmissionsNow", "waitForRoomRoundResultThenPlay");
  const playRoundStart = source.indexOf("async function playRoundInternal");
  const playRoundEnd = source.indexOf("async function playRound(", playRoundStart);
  const playRoundSource = source.slice(playRoundStart, playRoundEnd);
  assert.match(
    gradingSource,
    /waitForRoomRoundResultThenPlay\(getLockedRoundAnswer\(state\.currentOwner, state\.localAnswers\.playerOne \|\| ""\)\)/
  );
  assert.match(gradingSource, /else if \(isJoinedRoomClient\(\)\)/);
  assert.match(resolveSource, /if \(isJoinedRoomClient\(\)\)/);
  assert.match(playRoundSource, /isRoomMode\(\) && isJoinedRoomClient\(\) && !syncedRoundResult/);
  assert.doesNotMatch(
    gradingSource,
    /waitForRoomRoundResultThenPlay\(getLockedRoundAnswer\("player", state\.localAnswers\.playerOne/
  );
  const waitSource = getFunctionSource("waitForRoomRoundResultThenPlay", "maybeResolveRoomSubmissions");
  assert.match(waitSource, /tryPlayPendingRoomRoundResult\(localFallback\)/);
  assert.doesNotMatch(waitSource, /playSyncedRoomRoundResult\(result, localFallback\)/);
}

function testRoundResultTransportUsesTheLocalHostContext() {
  const functionSource = getFunctionSource("publishRoomRoundResult", "getImmediatePowerAffectedOwners");
  assert.match(functionSource, /if \(!isLocalRoomHostContext\(\)\)/);
  assert.match(functionSource, /!options\.retrying && isLocalRoomHostContext\(\) && !state\.matchEnded/);
  assert.match(functionSource, /broadcastRealtimeRoomChange\("round-result", code/);
  assert.match(functionSource, /peerResult: true/);
  assert.match(functionSource, /broadcastCommittedRoomRoundResultReady\(result, data, clientEventId\)/);
  assert.ok(
    functionSource.indexOf('broadcastRealtimeRoomChange("round-result", code')
      < functionSource.indexOf('roomSync.sendCommand("publish_round_result"'),
    "The completed result must reach joined players before the persistence request."
  );

  const readySource = getFunctionSource("broadcastCommittedRoomRoundResultReady", "getImmediatePowerAffectedOwners");
  assert.match(readySource, /broadcastRealtimeRoomChange\("round-result-ready", code/);
  assert.match(readySource, /resultRevision: revision/);

  const playRoundStart = source.indexOf("async function playRoundInternal");
  const playRoundEnd = source.indexOf("function isCurrentRoomRoundResultForPlayback", playRoundStart);
  const playRoundSource = source.slice(playRoundStart, playRoundEnd);
  assert.match(playRoundSource, /if \(!isLocalRoomHostContext\(\) \|\| syncedRoundResult\)/);
}

function testJoinedClientCanAdoptImmediateHostRoundResult() {
  const functionSource = getFunctionSource("applyRealtimeRoomRoundResult", "recoverRoomRoundResultFromServer");
  assert.match(functionSource, /const completePeerResult = Boolean\(/);
  assert.match(functionSource, /payload\.peerResult === true/);
  assert.match(functionSource, /\|\| completePeerResult/);
}

function testRoundResultDoesNotTransportThePowerEngine() {
  const resultSource = getFunctionSource("buildRoomRoundResultPayload", "getRoomRoundResultGameEnvelope");
  const envelopeSource = getFunctionSource("getRoomRoundResultGameEnvelope", "publishRoomRoundResult");
  const transportSource = getFunctionSource("publishRoomRoundResult", "broadcastCommittedRoomRoundResultReady");

  assert.match(resultSource, /result\.powerState = null/);
  assert.doesNotMatch(resultSource, /result\.powerState = getRoomPowerStatePayload\(\)/);
  assert.doesNotMatch(envelopeSource, /powerState:/);
  assert.match(transportSource, /const peerGame = getRoomRoundResultGameEnvelope\(result\)/);
  assert.match(transportSource, /game: peerGame/);
}

function testResultPresentationIsNotBlockedByPowerStateReconciliation() {
  const applySource = getFunctionSource("applyRealtimeRoomRoundResult", "recoverRoomRoundResultFromServer");
  const safeStateSource = getFunctionSource("applyRoomRoundResultStateSafely", "showWaitingForRoomRoundResult");
  const presentationSource = getFunctionSource("recoverRoomRoundResultPlayback", "playRound");

  assert.match(applySource, /applyRoomRoundResultStateSafely\(result, \{ source: "realtime-result" \}\)/);
  assert.match(safeStateSource, /try \{/);
  assert.match(safeStateSource, /catch \(error\)/);
  assert.match(presentationSource, /applyRoomRoundResultStateSafely\(syncedResult, \{/);
}

function testLocalHostContextDoesNotDependOnStaleDirectoryHostIdentity() {
  const functionSource = getFunctionSource("isLocalRoomHostContext", "isJoinedRoomClient");
  const context = {
    state: {
      isSpectator: false,
      joiningRoom: null,
      currentOwner: "player"
    },
    isRoomMode() {
      return true;
    }
  };
  vm.createContext(context);
  vm.runInContext(`${functionSource}\nthis.isLocalRoomHostContext = isLocalRoomHostContext;`, context);

  assert.equal(context.isLocalRoomHostContext(), true);
  context.state.joiningRoom = { code: "CAI-1234" };
  assert.equal(context.isLocalRoomHostContext(), false);
  context.state.joiningRoom = null;
  context.state.currentOwner = "opponent";
  assert.equal(context.isLocalRoomHostContext(), false);
}

function testRoundResultReadyRecoveryIsOutOfBand() {
  const recoverySource = getFunctionSource("recoverRoomRoundResultFromServer", "applyRealtimeRoomRoundResultReady");
  const readySource = getFunctionSource("applyRealtimeRoomRoundResultReady", "getSpectatorRoundResultPlaybackKey");
  const serverEventSource = getFunctionSource("applyRoomServerEvent", "applyRoomServerEventNow");

  assert.match(recoverySource, /since = resultRevision \? Math\.max\(0, resultRevision - 1\)/);
  assert.match(recoverySource, /requestRoomRealtimeCatchup\("round-result-ready"/);
  assert.match(readySource, /recoverRoomRoundResultFromServer\(payload\)/);
  assert.match(serverEventSource, /eventType === "round-result-ready"/);
  assert.match(serverEventSource, /Advancing the revision cursor here would make that result look stale/);
}

function testServerEventEnvelopeRoomCodeIsPreserved() {
  const serverEventSource = getFunctionSource("applyRoomServerEvent", "applyRoomServerEventNow");
  const applyNowSource = getFunctionSource("applyRoomServerEventNow", "refreshRoomEventsSinceLastRevision");

  assert.match(serverEventSource, /payload\.code \|\| payload\.room\?\.code \|\| event\.roomCode \|\| state\.roomSettings\.code/);
  assert.match(applyNowSource, /payload\.code \|\| payload\.room\?\.code \|\| event\.roomCode \|\| state\.roomSettings\.code/);
}

function testJoinedRoleDoesNotDependOnHostIdentity() {
  const functionSource = getFunctionSource("isJoinedRoomClient", "getExpectedRoomCurrentOwner");
  const context = {
    state: {
      isSpectator: false,
      currentOwner: "opponent",
      joiningRoom: { code: "CAI-1234" }
    },
    isRoomMode() {
      return true;
    }
  };
  vm.createContext(context);
  vm.runInContext(`${functionSource}\nthis.isJoinedRoomClient = isJoinedRoomClient;`, context);

  assert.equal(context.isJoinedRoomClient(), true);
  context.state.currentOwner = "player";
  assert.equal(context.isJoinedRoomClient(), true);
  context.state.joiningRoom = null;
  assert.equal(context.isJoinedRoomClient(), false);
}

function testAutoAdvanceUsesTheManualRoundTransitionCommand() {
  const functionSource = getFunctionSource("publishRoomRoundAdvancing", "publishRoomGameEnded");
  assert.match(functionSource, /const commandType = Number\(round\) <= 1 && !state\.roomGame/);
  assert.match(functionSource, /: "start_next_round";/);
  assert.doesNotMatch(functionSource, /\? "resolve_auto_advance"/);
  assert.match(functionSource, /nextRoundAt: 0/);

  const countdownSource = getFunctionSource("startNextRoundCountdown", "advanceAfterVerdict");
  assert.match(countdownSource, /void advanceAfterVerdict\(\);/);
  assert.doesNotMatch(countdownSource, /advanceAfterVerdict\(\{ autoAdvance: true \}\)/);

  const advanceSource = getFunctionSource("advanceAfterVerdict", "completeBlackCard");
  assert.match(advanceSource, /publishRoomRoundAdvancing\(nextRound\);/);
  assert.doesNotMatch(advanceSource, /publishRoomRoundAdvancing\(nextRound, \{/);
}

function testSetupPreservesOnlyCurrentRoomResult() {
  const functionSource = getFunctionSource("getRoomRoundResultToPreserveDuringSetup", "getOwnerFromRoomRoundParticipantId");
  const context = {
    state: {
      roomRoundResultPendingPlayback: null,
      roomRoundResult: {
        round: 2,
        matchId: "match-1",
        questionId: "question-2"
      },
      roomGame: null,
      joiningRoom: null,
      round: 2
    },
    getCurrentRoomMatchId() {
      return "match-1";
    },
    normalizeRoomRoundResultPayload(value) {
      return value && typeof value === "object" ? value : null;
    }
  };
  vm.createContext(context);
  vm.runInContext(`${functionSource}\nthis.getRoomRoundResultToPreserveDuringSetup = getRoomRoundResultToPreserveDuringSetup;`, context);

  assert.deepEqual(
    context.getRoomRoundResultToPreserveDuringSetup({ id: "question-2" }),
    { round: 2, matchId: "match-1", questionId: "question-2" }
  );
  assert.equal(context.getRoomRoundResultToPreserveDuringSetup({ id: "question-3" }), null);
}

async function testPendingResultWaitsForJoinedStage() {
  const functionSource = getFunctionSource("tryPlayPendingRoomRoundResult", "playSyncedRoomRoundResult");
  const pending = { round: 1, matchId: "match-1", questionId: "question-1" };
  const context = {
    state: {
      roomRoundResultPendingPlayback: pending,
      roomRoundResult: null,
      roomGame: null,
      joiningRoom: null,
      round: 1,
      isSpectator: false,
      matchEnded: false
    },
    normalizeRoomRoundResultPayload(value) {
      return value && typeof value === "object" ? value : null;
    },
    isRoomMode() {
      return true;
    },
    isJoinedRoomClient() {
      return true;
    },
    elements: {
      gameStage: {
        classList: { contains: () => false }
      }
    },
    isAuthoritativeRoomHost() {
      // A stale room snapshot can briefly identify the joined tab as host.
      // Playback must still follow the local joined-role marker.
      return true;
    },
    ensureRoomResultStageMounted() {},
    ensureRoomCurrentOwner() {},
    setPlayersForMode() {},
    setHidden() {},
    recoverRoomRoundResultPlayback() {
      return false;
    },
    playSyncedRoomRoundResult() {
      return false;
    }
  };
  vm.createContext(context);
  vm.runInContext(`${functionSource}\nthis.tryPlayPendingRoomRoundResult = tryPlayPendingRoomRoundResult;`, context);

  assert.equal(context.tryPlayPendingRoomRoundResult(), false);
  assert.deepEqual(context.state.roomRoundResultPendingPlayback, pending);

  context.recoverRoomRoundResultPlayback = () => true;
  assert.equal(context.tryPlayPendingRoomRoundResult(), true);
  assert.equal(context.state.roomRoundResultPendingPlayback, null);
}

async function testPendingResultCanRecoverAfterPresentationTokenIsInvalidated() {
  const functionSource = getFunctionSource("tryPlayPendingRoomRoundResult", "playSyncedRoomRoundResult");
  const pending = { round: 1, matchId: "match-1", questionId: "question-1" };
  let recovered = false;
  const context = {
    state: {
      roomRoundResultPendingPlayback: pending,
      roomRoundResult: pending,
      roomGame: null,
      joiningRoom: null,
      round: 1,
      isSpectator: false,
      matchEnded: false
    },
    normalizeRoomRoundResultPayload(value) {
      return value && typeof value === "object" ? value : null;
    },
    isRoomMode() {
      return true;
    },
    isJoinedRoomClient() {
      return true;
    },
    elements: {
      gameStage: {
        classList: { contains: () => false }
      }
    },
    isAuthoritativeRoomHost() {
      return false;
    },
    ensureRoomResultStageMounted() {},
    ensureRoomCurrentOwner() {},
    setPlayersForMode() {},
    setHidden() {},
    recoverRoomRoundResultPlayback() {
      recovered = true;
      return true;
    },
    playSyncedRoomRoundResult() {
      return false;
    }
  };
  vm.createContext(context);
  vm.runInContext(`${functionSource}\nthis.tryPlayPendingRoomRoundResult = tryPlayPendingRoomRoundResult;`, context);

  assert.equal(context.tryPlayPendingRoomRoundResult(), true);
  assert.equal(recovered, true);
  assert.equal(context.state.roomRoundResultPendingPlayback, null);
}

function testWaitingHostResultUsesImmediateAuthoritativeRecovery() {
  const functionSource = getFunctionSource("tryPlayPendingRoomRoundResult", "playSyncedRoomRoundResult");
  const pending = { round: 1, matchId: "match-1", questionId: "question-1" };
  let recovered = false;
  let animated = false;
  const context = {
    state: {
      roomRoundResultPendingPlayback: pending,
      roomRoundResult: pending,
      roomGame: null,
      joiningRoom: null,
      round: 1,
      isSpectator: false,
      matchEnded: false
    },
    normalizeRoomRoundResultPayload(value) {
      return value && typeof value === "object" ? value : null;
    },
    isRoomMode() {
      return true;
    },
    isJoinedRoomClient() {
      return true;
    },
    elements: {
      gameStage: {
        classList: { contains: () => false }
      },
      loadingPanel: {
        dataset: { loadingState: "waiting-host" }
      }
    },
    isAuthoritativeRoomHost() {
      return false;
    },
    ensureRoomResultStageMounted() {},
    ensureRoomCurrentOwner() {},
    setPlayersForMode() {},
    setHidden() {},
    recoverRoomRoundResultPlayback() {
      recovered = true;
      return true;
    },
    playSyncedRoomRoundResult() {
      animated = true;
      return true;
    }
  };
  vm.createContext(context);
  vm.runInContext(`${functionSource}\nthis.tryPlayPendingRoomRoundResult = tryPlayPendingRoomRoundResult;`, context);

  assert.equal(context.tryPlayPendingRoomRoundResult(), true);
  assert.equal(recovered, true);
  assert.equal(animated, false);
  assert.equal(context.state.roomRoundResultPendingPlayback, null);
}

function testPendingAuthoritativeResultSurvivesStaleLocalMatch() {
  const functionSource = getFunctionSource("isCurrentRoomRoundResultForPlayback", "recoverRoomRoundResultPlayback");
  const pending = { round: 1, matchId: "server-match", questionId: "question-1", cards: ["answer"] };
  const context = {
    state: {
      roomRoundResultPendingPlayback: pending,
      roomRoundResult: null,
      roomGame: { matchId: "old-match", round: 1 },
      joiningRoom: null,
      round: 1,
      matchEnded: false
    },
    normalizeRoomRoundResultPayload(value) {
      return value && typeof value === "object" ? value : null;
    },
    isRoomMode() {
      return true;
    },
    getRoomRoundResultPlaybackKey(result) {
      return `${result.matchId}|${result.round}|${result.questionId}`;
    },
    getRoomRoundResultForCurrentRound() {
      return null;
    }
  };
  vm.createContext(context);
  vm.runInContext(`${functionSource}\nthis.isCurrentRoomRoundResultForPlayback = isCurrentRoomRoundResultForPlayback;`, context);

  assert.equal(context.isCurrentRoomRoundResultForPlayback(pending), true);
}

async function testRejectedResultDoesNotFinishTheWait() {
  const functionSource = getFunctionSource("waitForRoomRoundResultThenPlay", "maybeResolveRoomSubmissions");
  let waitedForSyncEvent = false;
  let presenterCalls = 0;
  const context = {
    state: { matchWorkToken: "match-1", matchEnded: false },
    getRoomRoundResultForCurrentRound() {
      return { round: 1, cards: ["answer"] };
    },
    playSyncedRoomRoundResult() {
      presenterCalls += 1;
      return false;
    },
    tryPlayPendingRoomRoundResult() {
      presenterCalls += 1;
      return false;
    },
    isCurrentMatchWork() {
      return true;
    },
    isRoomMode() {
      return true;
    },
    showWaitingForRoomRoundResult() {},
    getRoomRoundResultWaitTimeoutMs() {
      return 1000;
    },
    waitForRoomSyncCondition(check) {
      waitedForSyncEvent = true;
      assert.equal(check(), "");
      return Promise.resolve("stale");
    },
    window: {
      clearTimeout() {}
    }
  };
  vm.createContext(context);
  vm.runInContext(`${functionSource}\nthis.waitForRoomRoundResultThenPlay = waitForRoomRoundResultThenPlay;`, context);

  await context.waitForRoomRoundResultThenPlay("", "match-1");
  assert.equal(presenterCalls, 2);
  assert.equal(waitedForSyncEvent, true);
}

(async () => {
  testRoomChannelIsReadyBeforeSubscribeCallback();
  await testGuestRoomJoinInitializesRealtimeWithoutAuth();
  testLobbyChannelIsReadyBeforeSubscribeCallback();
  testCompleteAuthoritativePhasePayloadCanRepairMissedRevision();
  testJoinedClientUsesRoomHostIdentityDuringDuplicateHostMerge();
  testJoinedGradingWaitUsesJoinedOwner();
  testRoundResultTransportUsesTheLocalHostContext();
  testJoinedClientCanAdoptImmediateHostRoundResult();
  testRoundResultDoesNotTransportThePowerEngine();
  testResultPresentationIsNotBlockedByPowerStateReconciliation();
  testLocalHostContextDoesNotDependOnStaleDirectoryHostIdentity();
  testRoundResultReadyRecoveryIsOutOfBand();
  testServerEventEnvelopeRoomCodeIsPreserved();
  testJoinedRoleDoesNotDependOnHostIdentity();
  testAutoAdvanceUsesTheManualRoundTransitionCommand();
  testSetupPreservesOnlyCurrentRoomResult();
  await testPendingResultWaitsForJoinedStage();
  await testPendingResultCanRecoverAfterPresentationTokenIsInvalidated();
  testWaitingHostResultUsesImmediateAuthoritativeRecovery();
  testPendingAuthoritativeResultSurvivesStaleLocalMatch();
  await testRejectedResultDoesNotFinishTheWait();
  console.log("Realtime client synchronization tests passed.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
