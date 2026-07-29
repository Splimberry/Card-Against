const assert = require("node:assert/strict");
const { Readable } = require("node:stream");

process.env.BACKEND_STORE = "memory";
process.env.ADMIN_TOKEN = "room-test-admin-token";
process.env.QUESTION_FILE_WRITES = "disabled";
process.env.RATE_LIMIT_DISABLED = "true";
process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_ANON_KEY = "test-anon-key";
process.env.SUPABASE_JWT_SECRET = "room-test-supabase-jwt-secret";

const handleRequest = require("../server");

function makeCode(seed) {
  return `CAI-${String(seed).padStart(4, "0")}`;
}

function safeRoomCookieCode(code) {
  return String(code || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "_");
}

function safeParticipantCookieId(participantId) {
  return String(participantId || "").trim().replace(/[^a-zA-Z0-9]/g, "_").slice(0, 48);
}

function getRoomHostCookieName(code) {
  return `cai_room_host_${safeRoomCookieCode(code)}`;
}

function getRoomParticipantCookieName(code, participantId) {
  return `cai_room_participant_${safeRoomCookieCode(code)}_${safeParticipantCookieId(participantId)}`;
}

function makeSetup(round = 1, overrides = {}) {
  return {
    id: `context-question-${round}`,
    type: "text",
    blackCard: `Context round ${round} question?`,
    difficulty: "easy",
    triviaTheme: "Science",
    canonicalAnswer: "Answer",
    acceptedAnswers: ["answer"],
    botCards: ["Wrong"],
    ...overrides
  };
}

function makeRoundResult(round = 1, overrides = {}) {
  return {
    matchId: overrides.matchId || "",
    round,
    questionId: `context-question-${round}`,
    cards: ["Host answer", "Player answer"],
    winner: { index: 0 },
    winnerIndex: 0,
    correctIndexes: [0],
    revealAnswerIndex: 0,
    updatedAt: Date.now(),
    ...overrides
  };
}

function makeRoom(code, overrides = {}) {
  const host = {
    id: "host-client",
    profileUserId: "guest:host-client",
    name: "Host",
    avatar: "",
    equippedTitleId: "",
    cardCustomization: null
  };
  return {
    code,
    status: "lobby",
    settings: {
      rounds: 5,
      timerSeconds: 30,
      maxPlayers: 5,
      harsh: false,
      chaos: false,
      timeMoney: false,
      amplified: false,
      wildFire: false,
      partyMayhem: false,
      classicMode: false,
      randomModifiers: false,
      autoAdvance: true,
      private: false,
      password: "",
      enabledThemes: ["Science"],
      code
    },
    host,
    participants: [
      {
        ...host,
        role: "host",
        host: true,
        spectator: false,
        bot: false,
        active: true,
        muted: false,
        status: "host",
        answer: "",
        submittedRound: 0,
        submissionMatchId: "",
        remainingTime: 0
      }
    ],
    banned: [],
    game: null,
    chat: [],
    ...overrides
  };
}

function createBrowserContext(label, ipSuffix) {
  const cookieJar = new Map();
  return {
    label,
    cookieJar,
    getCookie(name) {
      return cookieJar.get(name);
    },
    async request(method, path, body, headers = {}) {
      const chunks = body === undefined ? [] : [JSON.stringify(body)];
      const req = Readable.from(chunks);
      req.method = method;
      req.url = path;
      const storedCookieHeader = [...cookieJar.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
      req.headers = {
        host: `${label}.test.local`,
        "x-forwarded-for": `198.51.100.${ipSuffix}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...(storedCookieHeader ? { cookie: storedCookieHeader } : {}),
        ...headers
      };

      const result = await new Promise((resolve, reject) => {
        const res = {
          statusCode: 200,
          headers: {},
          writeHead(status, responseHeaders = {}) {
            this.statusCode = status;
            this.headers = responseHeaders;
          },
          end(data = "") {
            resolve({
              response: {
                status: this.statusCode,
                ok: this.statusCode >= 200 && this.statusCode < 300,
                headers: this.headers
              },
              text: String(data || "")
            });
          }
        };
        handleRequest(req, res).catch(reject);
      });

      const setCookie = result.response.headers["Set-Cookie"] || result.response.headers["set-cookie"];
      (Array.isArray(setCookie) ? setCookie : [setCookie]).filter(Boolean).forEach((entry) => {
        const [pair] = String(entry).split(";");
        const splitAt = pair.indexOf("=");
        if (splitAt > 0) {
          cookieJar.set(pair.slice(0, splitAt), pair.slice(splitAt + 1));
        }
      });

      return {
        response: result.response,
        payload: /^[\[{]/.test(result.text.trim()) ? JSON.parse(result.text) : result.text
      };
    }
  };
}

async function createRoom(hostContext, code, overrides = {}) {
  const room = makeRoom(code, overrides);
  const { response, payload } = await roomCommand(hostContext, code, "create_room", {
    room
  }, {
    participantId: room.host?.id || "host-client"
  });
  assert.equal(response.status, 200, payload.error);
  assert.ok(payload.room.revision >= 1);
  assert.ok(hostContext.getCookie(getRoomHostCookieName(code)));
  return payload.room;
}

function makeRoomCommandBody(code, type, payload = {}, overrides = {}) {
  const normalizedCode = String(code || "").trim().toUpperCase();
  const commandPayload = payload && typeof payload === "object" ? payload : {};
  const participantId = String(
    overrides.participantId
    || commandPayload.participantId
    || commandPayload.hostParticipantId
    || commandPayload.actorParticipantId
    || commandPayload.participant?.id
    || commandPayload.message?.participantId
    || commandPayload.host?.id
    || commandPayload.room?.host?.id
    || ""
  );
  return {
    type,
    roomCode: normalizedCode,
    participantId,
    clientInstanceId: commandPayload.clientInstanceId || "",
    tabSessionId: commandPayload.tabSessionId || commandPayload.participant?.tabSessionId || "",
    clientEventId: commandPayload.clientEventId || `${normalizedCode}:${type}:${Date.now()}:${Math.random()}`,
    payload: commandPayload
  };
}

async function roomCommand(context, code, type, payload = {}, overrides = {}) {
  return context.request("POST", `/api/rooms/${String(code || "").trim().toUpperCase()}/commands`, makeRoomCommandBody(code, type, payload, overrides));
}

function getEventPayload(commandPayload, type = "") {
  const events = Array.isArray(commandPayload?.events) ? commandPayload.events : [];
  const event = type
    ? [...events].reverse().find((entry) => entry.type === type)
    : events[events.length - 1];
  return event?.payload || {};
}

function withCommandEventFields(payload = {}, preferredEventType = "") {
  const eventPayload = getEventPayload(payload, preferredEventType);
  const events = Array.isArray(payload.events) ? payload.events : [];
  const event = preferredEventType
    ? [...events].reverse().find((entry) => entry.type === preferredEventType)
    : events[events.length - 1];
  return {
    ...payload,
    ...(event ? { eventType: String(event.type || "").replaceAll("_", "-") } : {}),
    ...eventPayload
  };
}

async function roomCommandWithRoom(context, code, type, payload = {}, preferredEventType = "") {
  const result = await roomCommand(context, code, type, payload);
  const enriched = withCommandEventFields(result.payload, preferredEventType);
  if (result.response.ok && !enriched.closed) {
    try {
      enriched.room = await getRoom(context, code);
    } catch {
      // Closed-room commands intentionally have no room snapshot to attach.
    }
  }
  return {
    response: result.response,
    payload: enriched
  };
}

async function getRoom(context, code) {
  const result = await context.request("GET", `/api/rooms/${code}`);
  assert.equal(result.response.status, 200, result.payload.error);
  return result.payload.room;
}

async function getEvents(context, code, since = 0) {
  const result = await context.request("GET", `/api/rooms/${code}/events?since=${encodeURIComponent(String(since))}`);
  assert.equal(result.response.status, 200, result.payload.error);
  return result.payload.events;
}

async function joinPlayer(context, code, participantId = "player-client", profileUserId = "guest:player-client") {
  const { response, payload } = await roomCommand(context, code, "join_room", {
    compact: true,
    includeRoom: true,
    participant: {
      id: participantId,
      profileUserId,
      name: "Player",
      active: true,
      status: "joined"
    }
  });
  assert.equal(response.status, 200, payload.error);
  assert.equal(payload.participant.id, participantId);
  assert.equal(payload.participant.role, "player");
  assert.ok(context.getCookie(getRoomParticipantCookieName(code, participantId)));
  return withCommandEventFields(payload);
}

async function joinSpectator(context, code, participantId = "spectator-client", profileUserId = "guest:spectator-client") {
  const { response, payload } = await roomCommand(context, code, "join_room", {
    compact: true,
    includeRoom: true,
    participant: {
      id: participantId,
      profileUserId,
      name: "Spectator",
      role: "spectator",
      spectator: true,
      active: true,
      status: "spectating"
    }
  });
  assert.equal(response.status, 200, payload.error);
  assert.equal(payload.participant.id, participantId);
  assert.equal(payload.participant.role, "spectator");
  assert.ok(context.getCookie(getRoomParticipantCookieName(code, participantId)));
  return withCommandEventFields(payload);
}

function eventTypes(events) {
  return events.map((event) => event.type);
}

async function testMembershipEventsSyncAcrossBrowserContexts() {
  const code = makeCode(9301);
  const host = createBrowserContext("host-membership", 11);
  const player = createBrowserContext("player-membership", 12);
  const spectator = createBrowserContext("spectator-membership", 13);

  const created = await createRoom(host, code);
  const playerJoin = await joinPlayer(player, code);
  const spectatorJoin = await joinSpectator(spectator, code);

  assert.equal(playerJoin.room.activePlayers, 2);
  assert.equal(spectatorJoin.room.activePlayers, 2);
  assert.equal(spectatorJoin.room.spectators, 1);

  const hostRoom = await getRoom(host, code);
  assert.equal(hostRoom.activePlayers, 2);
  assert.equal(hostRoom.spectators, 1);
  assert.equal(hostRoom.participants.some((participant) => participant.id === "player-client" && participant.role === "player"), true);
  assert.equal(hostRoom.participants.some((participant) => participant.id === "spectator-client" && participant.role === "spectator"), true);

  const hostEvents = await getEvents(host, code, created.revision);
  assert.deepEqual(eventTypes(hostEvents), ["participant_joined", "participant_joined"]);
  assert.equal(hostEvents[0].payload.participantId, "player-client");
  assert.equal(hostEvents[1].payload.participantId, "spectator-client");

  const spectatorLeave = await roomCommandWithRoom(spectator, code, "leave_room", {
    participantId: "spectator-client",
    reason: "browser-exit"
  });
  assert.equal(spectatorLeave.response.status, 200, spectatorLeave.payload.error);
  assert.equal(spectatorLeave.payload.room.spectators, 0);
  assert.equal(spectatorLeave.payload.room.activePlayers, 2);

  const playerEvents = await getEvents(player, code, spectatorJoin.revision);
  assert.equal(playerEvents.some((event) => event.type === "participant_left" && event.payload.participantId === "spectator-client"), true);

  const playerRoom = await getRoom(player, code);
  assert.equal(playerRoom.spectators, 0);
  assert.equal(playerRoom.participants.some((participant) => participant.id === "spectator-client"), false);
}

async function testModerationRejoinBanAndBotSyncAcrossBrowserContexts() {
  const code = makeCode(9302);
  const host = createBrowserContext("host-moderation", 21);
  const player = createBrowserContext("player-moderation", 22);
  const rejoin = createBrowserContext("player-rejoin", 23);
  const bannedRetry = createBrowserContext("player-banned-retry", 24);

  await createRoom(host, code);
  const joined = await joinPlayer(player, code, "player-client", "guest:moderated-player");

  const kick = await roomCommandWithRoom(host, code, "moderate_participant", {
    hostParticipantId: "host-client",
    participantId: "player-client",
    action: "kick"
  }, "participant_moderated");
  assert.equal(kick.response.status, 200, kick.payload.error);
  assert.equal(kick.payload.eventType, "participant-moderated");
  assert.equal(kick.payload.participant.status, "kicked");
  assert.equal(kick.payload.participant.active, false);
  assert.equal(kick.payload.room.activePlayers, 1);

  const rejoined = await joinPlayer(rejoin, code, "player-rejoin-client", "guest:moderated-player");
  assert.equal(rejoined.eventType, "participant-reconnected");
  assert.equal(rejoined.room.participants.some((participant) => participant.id === "player-client"), false);
  assert.equal(rejoined.room.participants.some((participant) => participant.id === "player-rejoin-client" && participant.active), true);
  assert.equal(rejoined.room.activePlayers, 2);

  const ban = await roomCommandWithRoom(host, code, "moderate_participant", {
    hostParticipantId: "host-client",
    participantId: "player-rejoin-client",
    action: "ban"
  }, "participant_moderated");
  assert.equal(ban.response.status, 200, ban.payload.error);
  assert.equal(ban.payload.banned.includes("guest:moderated-player"), true);
  assert.equal(ban.payload.room.participants.some((participant) => participant.id === "player-rejoin-client"), false);

  const blocked = await roomCommand(bannedRetry, code, "join_room", {
    compact: true,
    participant: {
      id: "blocked-player-client",
      profileUserId: "guest:moderated-player",
      name: "Player",
      active: true,
      status: "joined"
    }
  });
  assert.equal(blocked.response.status, 403);

  const botAdd = await roomCommandWithRoom(host, code, "add_bot", {
    hostParticipantId: "host-client",
    compact: true,
    includeRoom: true,
    participant: {
      id: "bot-client",
      name: "Bot",
      role: "bot",
      bot: true,
      active: true,
      status: "bot"
    }
  }, "participant_joined");
  assert.equal(botAdd.response.status, 200, botAdd.payload.error);
  assert.equal(botAdd.payload.participant.role, "bot");
  assert.equal(botAdd.payload.room.activePlayers, 2);

  const botKick = await roomCommandWithRoom(host, code, "moderate_participant", {
    hostParticipantId: "host-client",
    participantId: "bot-client",
    action: "kick"
  }, "participant_moderated");
  assert.equal(botKick.response.status, 200, botKick.payload.error);
  assert.equal(botKick.payload.room.participants.some((participant) => participant.id === "bot-client"), false);
  assert.equal(botKick.payload.room.activePlayers, 1);

  const botReplacement = await roomCommandWithRoom(host, code, "add_bot", {
    hostParticipantId: "host-client",
    compact: true,
    includeRoom: true,
    participant: {
      id: "bot-client-2",
      name: "Replacement Bot",
      role: "bot",
      bot: true,
      active: true,
      status: "bot"
    }
  });
  assert.equal(botReplacement.response.status, 200, botReplacement.payload.error);
  assert.equal(botReplacement.payload.room.participants.some((participant) => participant.id === "bot-client-2"), true);

  const hostEvents = await getEvents(host, code, joined.revision);
  assert.equal(hostEvents.some((event) => event.type === "participant_moderated" && event.payload.action === "kick"), true);
  assert.equal(hostEvents.some((event) => event.type === "participant_reconnected" && event.payload.participantId === "player-rejoin-client"), true);
  assert.equal(hostEvents.some((event) => event.type === "participant_moderated" && event.payload.action === "ban"), true);
}

async function testRoundLifecycleSyncsAcrossBrowserContexts() {
  const code = makeCode(9303);
  const matchId = `${code}-match-a`;
  const host = createBrowserContext("host-round", 31);
  const player = createBrowserContext("player-round", 32);
  const spectator = createBrowserContext("spectator-round", 33);

  await createRoom(host, code);
  await joinPlayer(player, code);
  await joinSpectator(spectator, code);

  const advancing = await roomCommandWithRoom(host, code, "start_next_round", {
    hostParticipantId: "host-client",
    matchId,
    round: 1,
    matchSettings: {
      rounds: 2,
      timerSeconds: 30,
      maxPlayers: 5,
      autoAdvance: true,
      enabledThemes: ["Science"]
    }
  }, "round_advancing");
  assert.equal(advancing.response.status, 200, advancing.payload.error);
  assert.equal(advancing.payload.eventType, "round-advancing");
  assert.equal(advancing.payload.game.status, "starting");
  assert.equal(advancing.payload.game.setup, null);

  const playerSetupAttempt = await roomCommand(player, code, "prepare_round", {
    matchId,
    round: 1,
    totalRounds: 2,
    setupSeed: `${code}-player-setup`
  });
  assert.equal(playerSetupAttempt.response.status, 403);

  const spectatorSetupAttempt = await roomCommand(spectator, code, "prepare_round", {
    matchId,
    round: 1,
    totalRounds: 2,
    setupSeed: `${code}-spectator-setup`
  });
  assert.equal(spectatorSetupAttempt.response.status, 403);

  const started = await roomCommandWithRoom(host, code, "prepare_round", {
    hostParticipantId: "host-client",
    matchId,
    round: 1,
    totalRounds: 2,
    enabledThemes: ["Science"],
    setupSeed: `${code}-round-1`
  }, "round_started");
  assert.equal(started.response.status, 200, started.payload.error);
  assert.equal(started.payload.eventType, "round-started");
  assert.equal(started.payload.game.status, "playing");
  assert.ok(started.payload.game.setup.blackCard);
  assert.equal(started.payload.game.participantTimers["host-client"].status, "running");
  assert.equal(started.payload.game.participantTimers["player-client"].status, "running");
  assert.equal(started.payload.game.participantTimers["spectator-client"], undefined);

  const playerRoom = await getRoom(player, code);
  const spectatorRoom = await getRoom(spectator, code);
  assert.equal(playerRoom.game.setup.id, started.payload.game.setup.id);
  assert.equal(spectatorRoom.game.setup.id, started.payload.game.setup.id);
  assert.deepEqual(playerRoom.game.setup.multipleChoiceOptions || [], started.payload.game.setup.multipleChoiceOptions || []);
  assert.deepEqual(spectatorRoom.game.setup.multipleChoiceOptions || [], started.payload.game.setup.multipleChoiceOptions || []);

  const playerAnswer = await roomCommandWithRoom(player, code, "submit_answer", {
    participantId: "player-client",
    matchId,
    round: 1,
    answer: "Player answer",
    remainingTime: 12
  }, "answer_submitted");
  assert.equal(playerAnswer.response.status, 200, playerAnswer.payload.error);
  assert.equal(playerAnswer.payload.eventType, "answer-submitted");
  assert.equal(playerAnswer.payload.grading, undefined);

  const spectatorEvents = await getEvents(spectator, code, started.payload.revision);
  assert.equal(spectatorEvents.some((event) => event.type === "answer_submitted" && event.payload.participantId === "player-client"), true);

  const hostAnswer = await roomCommandWithRoom(host, code, "submit_answer", {
    participantId: "host-client",
    matchId,
    round: 1,
    answer: "Host answer",
    remainingTime: 14
  }, "answer_submitted");
  hostAnswer.payload.grading = withCommandEventFields(hostAnswer.payload, "round_grading");
  assert.equal(hostAnswer.response.status, 200, hostAnswer.payload.error);
  assert.equal(hostAnswer.payload.grading.eventType, "round-grading");
  assert.equal(hostAnswer.payload.grading.reason, "all-submitted");
  assert.equal(hostAnswer.payload.grading.submissions.length, 2);

  const gradingRoom = await getRoom(spectator, code);
  assert.equal(gradingRoom.game.status, "grading");
  assert.equal(gradingRoom.game.answers["host-client"].answer, "Host answer");
  assert.equal(gradingRoom.game.answers["player-client"].answer, "Player answer");

  const result = await roomCommandWithRoom(host, code, "publish_round_result", {
    hostParticipantId: "host-client",
    roundResult: makeRoundResult(1, {
      matchId,
      cards: ["Host answer", "Player answer"],
      questionId: started.payload.game.setup.id,
      nextRoundAt: Date.now() + 30000
    })
  }, "round_result");
  assert.equal(result.response.status, 200, result.payload.error);
  assert.equal(result.payload.eventType, "round-result");
  assert.ok(result.payload.roundResult.nextRoundAt > Date.now());

  const nextRound = await roomCommandWithRoom(host, code, "start_next_round", {
    hostParticipantId: "host-client",
    matchId,
    round: 2,
    matchSettings: {
      rounds: 2,
      timerSeconds: 30,
      maxPlayers: 5,
      autoAdvance: true,
      enabledThemes: ["Science"]
    }
  }, "round_advancing");
  assert.equal(nextRound.response.status, 200, nextRound.payload.error);
  assert.equal(nextRound.payload.eventType, "round-advancing");
  assert.equal(nextRound.payload.game.status, "starting");
  assert.equal(nextRound.payload.game.round, 2);
  assert.equal(nextRound.payload.game.setup, null);
  assert.deepEqual(nextRound.payload.game.answers, {});
  assert.equal(nextRound.payload.game.roundResult, null);

  const spectatorNextRoom = await getRoom(spectator, code);
  assert.equal(spectatorNextRoom.game.round, 2);
  assert.equal(spectatorNextRoom.game.setup, null);
  assert.deepEqual(spectatorNextRoom.game.answers, {});

  const nextStarted = await roomCommandWithRoom(host, code, "prepare_round", {
    hostParticipantId: "host-client",
    matchId,
    round: 2,
    totalRounds: 2,
    enabledThemes: ["Science"],
    setupSeed: `${code}-round-2`
  }, "round_started");
  assert.equal(nextStarted.response.status, 200, nextStarted.payload.error);
  assert.equal(nextStarted.payload.game.round, 2);
  assert.deepEqual(nextStarted.payload.game.answers, {});
  assert.equal(nextStarted.payload.game.roundResult, null);
}

async function testPowerStateRematchAndLobbySyncAcrossBrowserContexts() {
  const code = makeCode(9304);
  const matchId = `${code}-match-a`;
  const host = createBrowserContext("host-power", 41);
  const player = createBrowserContext("player-power", 42);
  const spectator = createBrowserContext("spectator-power", 43);

  await createRoom(host, code);
  await joinPlayer(player, code);
  await joinSpectator(spectator, code);

  const advancing = await roomCommandWithRoom(host, code, "start_next_round", {
    hostParticipantId: "host-client",
    matchId,
    round: 1,
    matchSettings: {
      rounds: 5,
      timerSeconds: 30,
      maxPlayers: 5,
      autoAdvance: true,
      enabledThemes: ["Science"]
    }
  }, "round_advancing");
  assert.equal(advancing.response.status, 200, advancing.payload.error);

  const started = await roomCommandWithRoom(host, code, "prepare_round", {
    hostParticipantId: "host-client",
    matchId,
    round: 1,
    totalRounds: 5,
    enabledThemes: ["Science"],
    setupSeed: `${code}-power-round-1`,
    powerState: {
      matchId,
      updatedAt: Date.now(),
      hands: [
        { participantId: "host-client", owner: "player", hand: ["shuffle"], fresh: [] },
        { participantId: "player-client", owner: "opponent", hand: ["xray_hacks"], fresh: [] }
      ],
      played: [],
      players: [
        { participantId: "host-client", owner: "player", score: 0, streak: 0 },
        { participantId: "player-client", owner: "opponent", score: 0, streak: 0 }
      ],
      effects: { maps: {}, arrays: {}, values: {} }
    }
  }, "round_started");
  assert.equal(started.response.status, 200, started.payload.error);

  const power = await roomCommandWithRoom(player, code, "use_power", {
    matchId,
    round: 1,
    powerId: "xray_hacks",
    actorParticipantId: "player-client",
    hands: [
      { participantId: "player-client", owner: "opponent", hand: [], fresh: [] }
    ],
    played: [
      {
        participantId: "player-client",
        owner: "opponent",
        stacks: [{ powerId: "xray_hacks", revealId: "context-power-use", meta: {} }],
        primaryPowerId: "xray_hacks"
      }
    ],
    players: [
      { participantId: "player-client", owner: "opponent", score: 250, streak: 1 }
    ],
    effects: { maps: {}, arrays: {}, values: {} }
  }, "power_state");
  assert.equal(power.response.status, 200, power.payload.error);
  assert.equal(power.payload.eventType, "power-state");
  assert.ok(power.payload.powerRevision >= 1);
  assert.deepEqual(power.payload.powerState.hands.find((entry) => entry.participantId === "player-client").hand, []);
  assert.deepEqual(power.payload.powerState.hands.find((entry) => entry.participantId === "host-client").hand, ["shuffle"]);

  const hostPowerEvents = await getEvents(host, code, started.payload.room.revision);
  const playerPowerEvents = await getEvents(player, code, started.payload.room.revision);
  const spectatorPowerEvents = await getEvents(spectator, code, started.payload.room.revision);
  [hostPowerEvents, playerPowerEvents, spectatorPowerEvents].forEach((events) => {
    const event = events.find((entry) => entry.type === "power_state" && entry.payload.powerId === "xray_hacks");
    assert.ok(event);
    assert.equal(event.payload.powerRevision || event.payload.powerState.revision, power.payload.powerRevision);
    assert.equal(event.payload.powerState.hands.some((entry) => entry.participantId === "host-client"), true);
    assert.equal(event.payload.powerState.hands.some((entry) => entry.participantId === "player-client"), true);
  });

  const ended = await roomCommandWithRoom(host, code, "end_game", {
    hostParticipantId: "host-client",
    game: {
      matchId,
      status: "ended",
      round: 1,
      setup: makeSetup(1, {
        questionStyle: "multiple-choice",
        multipleChoiceOptions: ["Break point", "Set point", "Match point", "Game point"]
      }),
      answers: {
        "host-client": { participantId: "host-client", matchId, round: 1, answer: "Break point", status: "submitted" },
        "player-client": { participantId: "player-client", matchId, round: 1, answer: "Set point", status: "submitted" }
      },
      roundResult: makeRoundResult(1, {
        matchId,
        cards: ["Break point", "Set point"],
        questionId: "context-question-1"
      }),
      updatedAt: Date.now()
    }
  }, "game_ended");
  assert.equal(ended.response.status, 200, ended.payload.error);
  assert.equal(ended.payload.room.status, "complete");

  const lobby = await roomCommandWithRoom(host, code, "return_to_lobby", {
    hostParticipantId: "host-client",
    matchId
  }, "room_updated");
  assert.equal(lobby.response.status, 200, lobby.payload.error);
  assert.equal(lobby.payload.room.status, "lobby");
  assert.equal(lobby.payload.room.game, null);
  lobby.payload.room.participants.forEach((participant) => {
    assert.equal(participant.answer, "");
    assert.equal(participant.submittedRound, 0);
    assert.equal(participant.submissionMatchId, "");
  });

  const spectatorLobby = await getRoom(spectator, code);
  assert.equal(spectatorLobby.status, "lobby");
  assert.equal(spectatorLobby.game, null);

  const rematchId = `${code}-match-b`;
  const rematch = await roomCommandWithRoom(host, code, "start_next_round", {
    hostParticipantId: "host-client",
    matchId: rematchId,
    round: 1,
    matchSettings: {
      rounds: 2,
      timerSeconds: 30,
      maxPlayers: 5,
      autoAdvance: true,
      enabledThemes: ["Science"]
    }
  }, "round_advancing");
  assert.equal(rematch.response.status, 200, rematch.payload.error);
  assert.equal(rematch.payload.game.matchId, rematchId);
  assert.equal(rematch.payload.game.round, 1);
  assert.equal(rematch.payload.game.status, "starting");
  assert.equal(rematch.payload.game.setup, null);
  assert.deepEqual(rematch.payload.game.answers, {});
  assert.equal(rematch.payload.game.roundResult, null);

  const playerRematchRoom = await getRoom(player, code);
  assert.equal(playerRematchRoom.game.matchId, rematchId);
  assert.equal(playerRematchRoom.game.setup, null);
  assert.deepEqual(playerRematchRoom.game.answers, {});
  assert.equal(playerRematchRoom.game.roundResult, null);
}

async function main() {
  await testMembershipEventsSyncAcrossBrowserContexts();
  await testModerationRejoinBanAndBotSyncAcrossBrowserContexts();
  await testRoundLifecycleSyncsAcrossBrowserContexts();
  await testPowerStateRematchAndLobbySyncAcrossBrowserContexts();
  console.log("Multiplayer browser-context tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
