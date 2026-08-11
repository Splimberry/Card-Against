const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync(require.resolve("../app.js"), "utf8");

function getFunctionSource(name, nextName) {
  const start = Math.max(
    source.indexOf(`function ${name}`),
    source.indexOf(`async function ${name}`)
  );
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
  await testRejectedResultDoesNotFinishTheWait();
  console.log("Realtime client synchronization tests passed.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
