const assert = require("node:assert/strict");
const { createHmac } = require("node:crypto");
const { readFileSync } = require("node:fs");
const { Readable } = require("node:stream");

process.env.BACKEND_STORE = "memory";
process.env.ADMIN_TOKEN = "room-test-admin-token";
process.env.QUESTION_FILE_WRITES = "disabled";
process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_ANON_KEY = "test-anon-key";
process.env.SUPABASE_JWT_SECRET = "room-test-supabase-jwt-secret";

const handleRequest = require("../server");
const cookieJar = new Map();
const testShopCatalog = new Map([
  ["pattern:waves", { cost: 200 }],
  ["pattern:geometric", { cost: 200 }],
  ["pattern:scales", { cost: 200 }],
  ["pattern:carbon", { cost: 300 }],
  ["pattern:circuit", { cost: 200 }],
  ["pattern:hearts", { cost: 200 }],
  ["font:techno", { cost: 100 }],
  ["font:pop", { cost: 100 }],
  ["font:comic", { cost: 100 }],
  ["font:cursive", { cost: 100 }],
  ["font:minimalistic", { cost: 100 }],
  ["font:neon", { cost: 100 }],
  ["font:chunky", { cost: 100 }],
  ["font:poofy", { cost: 100 }],
  ["font:cutesy", { cost: 100 }],
  ["font:bubble", { cost: 100 }],
  ["font:gothic", { cost: 100 }]
]);
const testShopRotationIntervalMs = 3 * 60 * 60 * 1000;
const testShopRotationSize = 3;

function hashTestShopRotationValue(value = "", seed = 0) {
  let hash = 2166136261 ^ (Number(seed) >>> 0);
  String(value).split("").forEach((char) => {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  });
  return hash >>> 0;
}

function getTestRotatingShopKeys(timeMs = Date.now()) {
  const slot = Math.floor(Math.max(0, Number(timeMs) || 0) / testShopRotationIntervalMs);
  return [...testShopCatalog.keys()]
    .map((key) => ({ key, sort: hashTestShopRotationValue(key, slot) }))
    .sort((a, b) => a.sort - b.sort || a.key.localeCompare(b.key))
    .slice(0, testShopRotationSize)
    .map((entry) => entry.key);
}

function getTestRotatingShopItem(preferredType = "") {
  const keys = getTestRotatingShopKeys();
  const key = keys.find((entry) => !preferredType || entry.startsWith(`${preferredType}:`)) || keys[0];
  const [type, id] = key.split(":");
  return {
    key,
    type,
    id,
    cost: testShopCatalog.get(key).cost
  };
}

function makeCode(seed) {
  return `CAI-${String(seed).padStart(4, "0")}`;
}

function makeSetup(round = 1) {
  return {
    id: `test-question-${round}`,
    type: "text",
    blackCard: `Round ${round} question?`,
    difficulty: "easy",
    triviaTheme: "Science",
    canonicalAnswer: "Answer",
    acceptedAnswers: ["answer"],
    botCards: ["Wrong"]
  };
}

function makeRoundResult(round = 1, overrides = {}) {
  return {
    matchId: overrides.matchId || "",
    round,
    questionId: `test-question-${round}`,
    cards: ["Answer", "Wrong"],
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
    name: "Host",
    avatar: "",
    equippedTitleId: "",
    cardCustomization: null
  };
  return {
    code,
    status: "lobby",
    settings: {
      rounds: 10,
      timerSeconds: 30,
      maxPlayers: 5,
      harsh: false,
      chaos: false,
      timeMoney: false,
      amplified: false,
      wildFire: false,
      partyMayhem: false,
      classicMode: false,
      private: false,
      password: "",
      enabledThemes: ["Science"],
      code
    },
    host,
    participants: [
      {
        ...host,
        host: true,
        spectator: false,
        bot: false,
        active: true,
        muted: false,
        status: "host",
        answer: "",
        submittedRound: 0,
        remainingTime: 0
      }
    ],
    banned: [],
    game: null,
    chat: [],
    ...overrides
  };
}

async function request(method, path, body, headers = {}) {
  const chunks = body === undefined ? [] : [JSON.stringify(body)];
  const req = Readable.from(chunks);
  req.method = method;
  req.url = path;
  const cookieHeader = [...cookieJar.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
  req.headers = {
    host: "test.local",
    ...(body === undefined ? {} : { "content-type": "application/json" }),
    ...(cookieHeader ? { cookie: cookieHeader } : {}),
    ...headers
  };

  const result = await new Promise((resolve, reject) => {
    const res = {
      statusCode: 200,
      headers: {},
      writeHead(status, headers = {}) {
        this.statusCode = status;
        this.headers = headers;
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

function makeRoomCommandBody(code, type, payload = {}, overrides = {}) {
  const normalizedCode = String(code || "").trim().toUpperCase();
  const commandPayload = payload && typeof payload === "object" ? payload : {};
  const participantId = String(
    overrides.participantId
    || commandPayload.participantId
    || commandPayload.hostParticipantId
    || commandPayload.actorParticipantId
    || commandPayload.participant?.id
    || commandPayload.host?.id
    || commandPayload.room?.host?.id
    || ""
  );
  return {
    type,
    roomCode: normalizedCode,
    participantId,
    clientInstanceId: overrides.clientInstanceId || commandPayload.clientInstanceId || "",
    tabSessionId: overrides.tabSessionId || commandPayload.tabSessionId || commandPayload.participant?.tabSessionId || "",
    clientEventId: overrides.clientEventId || commandPayload.clientEventId || `${normalizedCode}:${type}:${Date.now()}:${Math.random()}`,
    payload: commandPayload
  };
}

async function roomCommand(code, type, payload = {}, headers = {}, overrides = {}) {
  return request("POST", `/api/rooms/${String(code || "").trim().toUpperCase()}/commands`, makeRoomCommandBody(code, type, payload, overrides), headers);
}

function getTestClientRoomEventType(type = "") {
  return String(type || "room_updated").replaceAll("_", "-");
}

async function enrichRoomCommandResult(code, result, options = {}) {
  const commandPayload = result?.payload && typeof result.payload === "object" ? result.payload : {};
  const events = Array.isArray(commandPayload.events) ? commandPayload.events : [];
  const event = (options.preferredEventType
    ? [...events].reverse().find((entry) => entry.type === options.preferredEventType)
    : null) || (events.length ? events[events.length - 1] : null);
  const eventPayload = event?.payload && typeof event.payload === "object" ? event.payload : {};
  const enriched = {
    ...commandPayload,
    ...(event ? { eventType: getTestClientRoomEventType(event.type), ...eventPayload } : {})
  };
  const gradingEvent = events.find((entry) => entry.type === "round_grading");
  if (gradingEvent?.payload) {
    enriched.grading = {
      eventType: getTestClientRoomEventType(gradingEvent.type),
      ...gradingEvent.payload
    };
  }
  if (options.includeStoredRoom !== false && !enriched.closed) {
    const stored = await getRoom(code);
    if (stored.response.status === 200 && stored.payload?.room) {
      enriched.room = stored.payload.room;
    }
  }
  if (options.answerParticipantId && enriched.room?.game?.answers) {
    const answer = enriched.room.game.answers[options.answerParticipantId];
    if (answer) {
      enriched.answer = answer.answer;
      enriched.remainingTime = answer.remainingTime;
      enriched.submissionStatus = answer.status;
      enriched.autoSubmitted = Boolean(answer.autoSubmitted);
      enriched.matchId = answer.matchId;
      enriched.round = answer.round;
    }
  }
  return {
    response: result.response,
    payload: enriched
  };
}

function getParticipantCommandId(body = {}) {
  return String(body.participantId || body.hostParticipantId || body.actorParticipantId || body.participant?.id || "host-client");
}

async function roomPresenceCommand(code, body = {}, headers = {}) {
  const participant = body.participant && typeof body.participant === "object" ? body.participant : {};
  const role = String(participant.role || (participant.bot ? "bot" : participant.spectator ? "spectator" : participant.host ? "host" : "player"));
  const hasSubmission = Object.hasOwn(participant, "submittedRound")
    || Object.hasOwn(participant, "remainingTime");
  if (hasSubmission && role !== "spectator") {
    const participantId = getParticipantCommandId(body);
    return enrichRoomCommandResult(code, await roomCommand(code, "submit_answer", {
      ...body,
      participantId,
      matchId: participant.submissionMatchId || body.matchId || "",
      round: participant.submittedRound || body.round || 0,
      answer: participant.answer || "",
      remainingTime: participant.remainingTime || 0,
      timedOut: String(participant.status || "") === "timed_out",
      autoSubmitted: Boolean(participant.autoSubmitted)
    }, headers), {
      answerParticipantId: participantId,
      preferredEventType: "answer_submitted",
      includeStoredRoom: body.compact !== true || body.includeRoom === true || body.includeRoomSnapshot === true
    });
  }
  if (participant.active === false) {
    return enrichRoomCommandResult(code, await roomCommand(code, "disconnect_participant", body, headers), {
      includeStoredRoom: body.compact !== true || body.includeRoom === true || body.includeRoomSnapshot === true
    });
  }
  if (role === "bot") {
    return enrichRoomCommandResult(code, await roomCommand(code, "add_bot", {
      ...body,
      participant,
      participantId: body.hostParticipantId || body.participantId || "host-client",
      name: participant.name || body.name || "Bot"
    }, headers), {
      includeStoredRoom: body.compact !== true || body.includeRoom === true || body.includeRoomSnapshot === true
    });
  }
  return enrichRoomCommandResult(code, await roomCommand(code, body.rejoin ? "rejoin_room" : "join_room", body, headers), {
    includeStoredRoom: body.compact !== true || body.includeRoom === true || body.includeRoomSnapshot === true
  });
}

async function roomLeaveCommand(code, body = {}, headers = {}) {
  const result = await enrichRoomCommandResult(code, await roomCommand(code, "leave_room", body, headers));
  if (result.payload && !Object.hasOwn(result.payload, "closed")) {
    result.payload.closed = false;
  }
  return result;
}

async function roomSettingsCommand(code, body = {}, headers = {}) {
  return enrichRoomCommandResult(code, await roomCommand(code, "update_settings", body, headers));
}

async function roomChatCommand(code, body = {}, headers = {}) {
  return enrichRoomCommandResult(code, await roomCommand(code, "send_chat", {
    participantId: body.participantId || body.message?.participantId || body.message?.owner || "",
    ...body
  }, headers), {
    includeStoredRoom: body.compact !== true
  });
}

async function roomGameCommand(code, body = {}, headers = {}) {
  const game = body.game && typeof body.game === "object" ? body.game : body;
  let type = String(game.status || "") === "ended" || String(body.status || "") === "complete" ? "end_game" : "start_match";
  if (type === "start_match") {
    const current = await getRoom(code);
    if (current.response.status === 200 && current.payload?.room?.status === "complete") {
      type = "rematch";
    }
  }
  return enrichRoomCommandResult(code, await roomCommand(code, type, {
    ...body,
    ...(body.game && typeof body.game === "object" ? body.game : {})
  }, headers));
}

async function roomLobbyCommand(code, body = {}, headers = {}) {
  return enrichRoomCommandResult(code, await roomCommand(code, "return_to_lobby", body, headers));
}

async function roomRoundAdvancingCommand(code, body = {}, headers = {}) {
  return enrichRoomCommandResult(code, await roomCommand(code, "start_next_round", body, headers));
}

async function roomRoundSetupCommand(code, body = {}, headers = {}) {
  return enrichRoomCommandResult(code, await roomCommand(code, "prepare_round", body, headers));
}

async function roomAnswerCommand(code, body = {}, headers = {}) {
  return enrichRoomCommandResult(code, await roomCommand(code, "submit_answer", body, headers), {
    answerParticipantId: body.participantId,
    preferredEventType: "answer_submitted"
  });
}

async function roomGradingCommand(code, body = {}, headers = {}) {
  return enrichRoomCommandResult(code, await roomCommand(code, "skip_to_grading", body, headers));
}

async function roomResolveAllSubmittedCommand(code, body = {}, headers = {}) {
  return enrichRoomCommandResult(code, await roomCommand(code, "resolve_all_submitted", body, headers));
}

async function roomPowerStateCommand(code, body = {}, headers = {}) {
  return enrichRoomCommandResult(code, await roomCommand(code, "use_power", body, headers), {
    includeStoredRoom: false
  });
}

async function roomAdminPowerDebugCommand(code, body = {}, headers = {}) {
  return enrichRoomCommandResult(code, await roomCommand(code, "admin_power_debug", body, headers), {
    includeStoredRoom: false
  });
}

async function roomRoundResultCommand(code, body = {}, headers = {}) {
  return enrichRoomCommandResult(code, await roomCommand(code, "publish_round_result", body, headers));
}

async function roomRoundSkipCommand(code, body = {}, headers = {}) {
  return enrichRoomCommandResult(code, await roomCommand(code, "skip_to_grading", body, headers));
}

async function roomModerationCommand(code, body = {}, headers = {}) {
  return enrichRoomCommandResult(code, await roomCommand(code, "moderate_participant", body, headers));
}

async function roomCloseCommand(code, body = {}, headers = {}) {
  return enrichRoomCommandResult(code, await roomCommand(code, "leave_room", body, headers), {
    includeStoredRoom: false
  });
}

async function upsertRoom(room) {
  const code = String(room?.code || "").trim().toUpperCase();
  await request("DELETE", `/api/admin/rooms/${code}`, undefined, adminHeaders());
  const { response, payload } = await roomCommand(code, "create_room", { room }, {}, {
    participantId: room?.host?.id || "host-client"
  });
  assert.equal(response.status, 200, payload.error);
  assert.ok(payload.room.revision >= 1);
  return payload.room;
}

function getMultiplayerPowerTransportTestIds() {
  const source = readFileSync(new URL("../app.js", `file://${__filename}`), "utf8");
  const collectIds = (startMarker, endMarker) => {
    const start = source.indexOf(startMarker);
    const end = source.indexOf(endMarker, start);
    assert.ok(start >= 0 && end > start, `Could not locate ${startMarker}.`);
    return [...new Set(
      [...source.slice(start, end).matchAll(/\bid:\s*"([^"]+)"/g)]
        .map((match) => match[1])
    )];
  };
  const traditional = collectIds("const powerDeck = [", "const mutationPowerDeck");
  const mutation = collectIds("const mutationPowerDeck", "const powerMap");
  const chaosStart = source.indexOf("const chaosInfusedPowerOverrides = {");
  const chaosEnd = source.indexOf("const powerSuggestionTextById", chaosStart);
  assert.ok(chaosStart >= 0 && chaosEnd > chaosStart, "Could not locate Chaos power overrides.");
  const chaosIds = [...new Set(
    [...source.slice(chaosStart, chaosEnd).matchAll(/^  ([a-z0-9_]+): \{/gm)]
      .map((match) => `${match[1]}__chaos`)
  )];
  return [...new Set([...traditional, ...mutation, ...chaosIds])];
}

async function listRooms() {
  const { response, payload } = await request("GET", "/api/rooms");
  assert.equal(response.status, 200, payload.error);
  return payload.rooms;
}

async function getRoom(code) {
  return request("GET", `/api/rooms/${code}`);
}

function testClientUsesRoomCommandEndpointsForMultiplayerWrites() {
  const source = readFileSync(new URL("../app.js", `file://${__filename}`), "utf8");
  const legacyWriteEndpointPattern = /\/api\/rooms\/[^"'`]*\/(?:presence|chat|power-state|game|lobby|settings|moderation|answer|round-setup|round-advancing|round-result|grading|round-skip|leave)\b/g;
  const matches = source.match(legacyWriteEndpointPattern) || [];
  assert.deepEqual(matches, [], "app.js should use /api/rooms/:code/commands for multiplayer writes.");
  assert.equal(
    source.includes('roomSync.sendCommand("resolve_all_submitted"'),
    false,
    "The browser must not infer or race the server-authoritative grading transition."
  );
}

function makeQuestion(id, overrides = {}) {
  return {
    id,
    type: "text",
    theme: "Science",
    difficulty: "easy",
    question: `What is the test answer for ${id}?`,
    canonicalAnswer: "Answer",
    acceptedAnswers: ["answer"],
    botCards: ["Wrong one", "Wrong two"],
    ...overrides
  };
}

function adminHeaders() {
  return { authorization: `Bearer ${process.env.ADMIN_TOKEN}` };
}

function makeJwt(payload = {}, secret = process.env.SUPABASE_JWT_SECRET) {
  const encodedHeader = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const encodedPayload = Buffer.from(JSON.stringify({
    sub: "auth-user-default",
    aud: "authenticated",
    exp: Math.floor(Date.now() / 1000) + 3600,
    ...payload
  })).toString("base64url");
  const signature = createHmac("sha256", secret)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest("base64url");
  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

function authHeaders(userId) {
  return { authorization: `Bearer ${makeJwt({ sub: userId })}` };
}

function roomParticipantCookieHeader(code, participantId) {
  const safeCode = String(code || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "_");
  const safeParticipantId = String(participantId || "").trim().replace(/[^a-zA-Z0-9]/g, "_").slice(0, 48);
  const name = `cai_room_participant_${safeCode}_${safeParticipantId}`;
  const value = cookieJar.get(name);
  assert.ok(value, `Missing participant cookie ${name}`);
  return { cookie: `${name}=${value}` };
}

async function getDebugQuestions() {
  const { response, payload } = await request("GET", "/api/debug/questions", undefined, adminHeaders());
  assert.equal(response.status, 200, payload.error);
  return payload.questions;
}

async function testSupabaseConfigEndpoint() {
  const { response, payload } = await request("GET", "/api/auth/supabase-config");
  assert.equal(response.status, 200, payload.error);
  assert.equal(payload.enabled, true);
  assert.equal(payload.url, process.env.SUPABASE_URL);
  assert.equal(payload.anonKey, process.env.SUPABASE_ANON_KEY);
}

async function testHostLeaveDeletesRoom() {
  const code = makeCode(8101);
  await upsertRoom(makeRoom(code));
  const { response, payload } = await roomLeaveCommand(code, {
    participantId: "host-client",
    reason: "manual"
  });
  assert.equal(response.status, 200, payload.error);
  assert.equal(payload.closed, true);
  assert.equal(payload.reason, "host-left");
  const rooms = await listRooms();
  assert.equal(rooms.some((room) => room.code === code), false);
  const directRoom = await getRoom(code);
  assert.equal(directRoom.response.status, 410);
  assert.equal(directRoom.payload.closed, true);
  assert.equal(directRoom.payload.close.reason, "host-left");
}

async function testDirectRoomLookupIncludesCompleteRooms() {
  const code = makeCode(8100);
  await upsertRoom(makeRoom(code, { status: "complete" }));
  const rooms = await listRooms();
  assert.equal(rooms.some((room) => room.code === code), false);
  const { response, payload } = await getRoom(code);
  assert.equal(response.status, 200, payload.error);
  assert.equal(payload.room.code, code);
  assert.equal(payload.room.status, "complete");
}

async function testBrowserExitRemovesJoinedPlayer() {
  const code = makeCode(8105);
  await upsertRoom(makeRoom(code, {
    participants: [
      {
        id: "host-client",
        name: "Host",
        host: true,
        spectator: false,
        bot: false,
        active: true,
        muted: false,
        status: "host"
      },
      {
        id: "guest-client",
        name: "Guest",
        host: false,
        spectator: false,
        bot: false,
        active: true,
        muted: false,
        status: "joined"
      }
    ]
  }));

  const { response, payload } = await roomLeaveCommand(code, {
    participantId: "guest-client",
    reason: "browser-exit"
  });
  assert.equal(response.status, 200, payload.error);
  assert.equal(payload.closed, false);
  assert.equal(payload.room.participants.some((participant) => participant.id === "guest-client"), false);
  assert.equal(payload.room.participants.some((participant) => participant.id === "host-client"), true);
}

async function testBrowserExitDeletesRoomWhenNoRealPlayersRemain() {
  const code = makeCode(8106);
  await upsertRoom(makeRoom(code, {
    participants: [
      {
        id: "host-client",
        name: "Host",
        host: true,
        spectator: false,
        bot: false,
        active: false,
        muted: false,
        status: "left"
      },
      {
        id: "guest-client",
        name: "Guest",
        host: false,
        spectator: false,
        bot: false,
        active: true,
        muted: false,
        status: "joined"
      },
      {
        id: "bot-client",
        name: "Bot",
        host: false,
        spectator: false,
        bot: true,
        active: true,
        muted: false,
        status: "bot"
      }
    ]
  }));

  const { response, payload } = await roomLeaveCommand(code, {
    participantId: "guest-client",
    reason: "browser-exit"
  });
  assert.equal(response.status, 200, payload.error);
  assert.equal(payload.closed, true);
  assert.equal(payload.reason, "empty-room");
  const directRoom = await getRoom(code);
  assert.equal(directRoom.response.status, 410);
  assert.equal(directRoom.payload.closed, true);
  assert.equal(directRoom.payload.close.reason, "empty-room");
}

async function testRoomListClosesStoredRoomsWithoutActivePlayersAfterGrace() {
  const code = makeCode(8107);
  const staleAt = Date.now() - (3 * 60 * 1000 + 1000);
  await upsertRoom(makeRoom(code, {
    updatedAt: staleAt,
    participants: [
      {
        id: "host-client",
        name: "Host",
        host: true,
        spectator: false,
        bot: false,
        active: false,
        muted: false,
        status: "left",
        disconnectedAt: staleAt,
        lastSeenAt: staleAt
      },
      {
        id: "bot-client",
        name: "Bot",
        host: false,
        spectator: false,
        bot: true,
        active: false,
        muted: false,
        status: "bot"
      }
    ]
  }));

  const rooms = await listRooms();
  assert.equal(rooms.some((room) => room.code === code), false);
  const { response, payload } = await getRoom(code);
  assert.equal(response.status, 410);
  assert.equal(payload.closed, true);
  assert.equal(payload.close.reason, "empty-room");
}

async function testRoomListClosesStaleSinglePlayerRoomAfterGrace() {
  const code = makeCode(8205);
  const staleAt = Date.now() - (3 * 60 * 1000 + 1000);
  await upsertRoom(makeRoom(code, {
    host: {
      id: "guest-client",
      profileUserId: "guest:stale",
      name: "Guest",
      avatar: "",
      equippedTitleId: "",
      cardCustomization: null
    },
    updatedAt: staleAt,
    participants: [
      {
        id: "guest-client",
        profileUserId: "guest:stale",
        name: "Guest",
        host: true,
        spectator: false,
        bot: false,
        active: true,
        muted: false,
        status: "host",
        joinedAt: staleAt,
        lastConnectedAt: staleAt,
        lastSeenAt: staleAt
      }
    ]
  }));

  const rooms = await listRooms();
  assert.equal(rooms.some((room) => room.code === code), false);
  const directRoom = await getRoom(code);
  assert.equal(directRoom.response.status, 410);
  assert.equal(directRoom.payload.closed, true);
  assert.equal(directRoom.payload.close.reason, "empty-room");
}

async function testRoomListUsesParticipantsWhenActiveCountIsMissing() {
  const code = makeCode(8108);
  const room = makeRoom(code);
  delete room.activePlayers;
  await upsertRoom(room);

  const rooms = await listRooms();
  const listedRoom = rooms.find((entry) => entry.code === code);
  assert.ok(listedRoom);
  assert.equal(listedRoom.participants.some((participant) => participant.id === "host-client" && participant.active), true);
}

async function testRoomDirectoryAcceptsProfileImagePayload() {
  const code = makeCode(8110);
  const avatar = `data:image/png;base64,${"a".repeat(32_000)}`;
  const room = makeRoom(code, {
    host: {
      id: "host-client",
      name: "Host",
      avatar,
      equippedTitleId: "",
      cardCustomization: null
    },
    participants: [
      {
        id: "host-client",
        name: "Host",
        avatar,
        equippedTitleId: "",
        cardCustomization: null,
        host: true,
        spectator: false,
        bot: false,
        active: true,
        muted: false,
        status: "host"
      }
    ]
  });
  const stored = await upsertRoom(room);
  assert.equal(stored.host.avatar, avatar);
  const rooms = await listRooms();
  assert.equal(rooms.some((entry) => entry.code === code), true);
}

async function testRoomDirectoryPreservesProfileStyleFields() {
  const code = makeCode(8111);
  const cardCustomization = {
    styleId: "gradient",
    gradientTop: "green",
    gradientBottom: "gold",
    effectIds: ["rgb", "text-glow"],
    patternId: "circuit",
    fontId: "mono",
    titleColourId: "pink",
    titleRgb: true,
    titlePastel: true
  };
  const specialBadges = [{ id: "admin", count: 0 }, { id: "creator", count: 8 }];
  const stored = await upsertRoom(makeRoom(code, {
    host: {
      id: "host-client",
      name: "Host",
      avatar: "",
      equippedTitleId: "test-title",
      specialBadges,
      cardCustomization
    },
    participants: []
  }));

  assert.equal(stored.host.cardCustomization.fontId, "mono");
  assert.equal(stored.host.cardCustomization.titleColourId, "pink");
  assert.equal(stored.host.cardCustomization.titleRgb, true);
  assert.equal(stored.host.cardCustomization.titlePastel, true);
  assert.deepEqual(stored.host.specialBadges, specialBadges);
  const hostParticipant = stored.participants.find((participant) => participant.host);
  assert.ok(hostParticipant);
  assert.deepEqual(hostParticipant.specialBadges, specialBadges);
  assert.equal(hostParticipant.cardCustomization.fontId, "mono");
}

async function testPrivateRoomPasswordIsRedactedAndServerValidated() {
  const code = makeCode(8120);
  await upsertRoom(makeRoom(code, {
    settings: {
      ...makeRoom(code).settings,
      private: true,
      password: "secret-pass"
    }
  }));

  const rooms = await listRooms();
  const listed = rooms.find((room) => room.code === code);
  assert.ok(listed);
  assert.equal(Object.hasOwn(listed.settings, "password"), false);
  assert.equal(listed.settings.passwordRequired, true);

  const direct = await request("GET", `/api/rooms/${code}`, undefined, { cookie: "" });
  assert.equal(direct.response.status, 200, direct.payload.error);
  assert.equal(Object.hasOwn(direct.payload.room.settings, "password"), false);
  assert.equal(direct.payload.room.settings.passwordRequired, true);

  const wrongPassword = await roomPresenceCommand(code, {
    participant: {
      id: "private-guest-wrong",
      name: "Guest",
      active: true,
      status: "joined"
    },
    password: "wrong"
  }, { cookie: "" });
  assert.equal(wrongPassword.response.status, 403);

  const correctPassword = await roomPresenceCommand(code, {
    compact: true,
    participant: {
      id: "private-guest-right",
      name: "Guest",
      active: true,
      status: "joined"
    },
    password: "secret-pass"
  }, { cookie: "" });
  assert.equal(correctPassword.response.status, 200, correctPassword.payload.error);
  assert.equal(correctPassword.payload.participant.id, "private-guest-right");

  const settingsUpdate = await roomSettingsCommand(code, {
    hostParticipantId: "host-client",
    status: "lobby",
    settings: {
      private: true,
      password: "new-secret",
      enabledThemes: ["Science"]
    }
  });
  assert.equal(settingsUpdate.response.status, 200, settingsUpdate.payload.error);
  const events = await request("GET", `/api/rooms/${code}/events?since=0`, undefined, { cookie: "" });
  assert.equal(events.response.status, 200, events.payload.error);
  const settingsEvent = events.payload.events.find((event) => event.type === "settings_updated");
  assert.ok(settingsEvent);
  assert.equal(Object.hasOwn(settingsEvent.payload.settings, "password"), false);
}

async function testPrivateToggleWithoutPasswordRemainsPublic() {
  const code = makeCode(8128);
  await upsertRoom(makeRoom(code, {
    settings: {
      ...makeRoom(code).settings,
      private: true,
      password: "   "
    }
  }));

  const direct = await request("GET", `/api/rooms/${code}`, undefined, { cookie: "" });
  assert.equal(direct.response.status, 200, direct.payload.error);
  assert.equal(direct.payload.room.settings.passwordRequired, false);

  const guest = await roomPresenceCommand(code, {
    compact: true,
    participant: {
      id: "toggle-without-password-guest",
      name: "Guest",
      active: true,
      status: "joined"
    }
  }, { cookie: "" });
  assert.equal(guest.response.status, 200, guest.payload.error);
}

async function testHostCookieRequiredForPrivilegedRoomActions() {
  const code = makeCode(8121);
  await upsertRoom(makeRoom(code));

  const forgedClose = await roomCloseCommand(code, {
    participantId: "host-client",
    reason: "forged"
  }, { cookie: "" });
  assert.equal(forgedClose.response.status, 403);

  const forgedHostPresence = await roomPresenceCommand(code, {
    participant: {
      id: "attacker-client",
      name: "Attacker",
      host: true,
      active: true,
      status: "host"
    }
  }, { cookie: "" });
  assert.equal(forgedHostPresence.response.status, 403);

  const realClose = await roomCloseCommand(code, {
    participantId: "host-client",
    reason: "manual"
  });
  assert.equal(realClose.response.status, 200, realClose.payload.error);
  assert.equal(realClose.payload.closed, true);
}

async function testParticipantCookieRequiredForRoomActions() {
  const code = makeCode(8122);
  await upsertRoom(makeRoom(code));
  const join = await roomPresenceCommand(code, {
    compact: true,
    participant: {
      id: "secure-guest",
      name: "Guest",
      active: true,
      status: "joined"
    }
  }, { cookie: "" });
  assert.equal(join.response.status, 200, join.payload.error);
  assert.equal(join.payload.participant.id, "secure-guest");

  const forgedPresence = await roomPresenceCommand(code, {
    compact: true,
    participant: {
      id: "secure-guest",
      name: "Attacker",
      active: true,
      status: "submitted",
      answer: "Forged"
    }
  }, { cookie: "" });
  assert.equal(forgedPresence.response.status, 403, forgedPresence.payload.error);

  const forgedChat = await roomChatCommand(code, {
    compact: true,
    message: {
      id: "forged-chat",
      sender: "Guest",
      owner: "opponent",
      participantId: "secure-guest",
      text: "Forged",
      createdAt: Date.now()
    }
  }, { cookie: "" });
  assert.equal(forgedChat.response.status, 403);

  const realChat = await roomChatCommand(code, {
    compact: true,
    message: {
      id: "secure-chat",
      sender: "Guest",
      owner: "opponent",
      participantId: "secure-guest",
      text: "Real",
      createdAt: Date.now()
    }
  }, roomParticipantCookieHeader(code, "secure-guest"));
  assert.equal(realChat.response.status, 200, realChat.payload.error);

  const forgedPower = await roomPowerStateCommand(code, {
    round: 1,
    powerId: "xray_hacks",
    actorParticipantId: "secure-guest",
    hands: []
  }, { cookie: "" });
  assert.equal(forgedPower.response.status, 403);

  const forgedLeave = await roomLeaveCommand(code, {
    participantId: "secure-guest",
    reason: "forged"
  }, { cookie: "" });
  assert.equal(forgedLeave.response.status, 403);

  const realLeave = await roomLeaveCommand(code, {
    participantId: "secure-guest",
    reason: "manual"
  }, roomParticipantCookieHeader(code, "secure-guest"));
  assert.equal(realLeave.response.status, 200, realLeave.payload.error);
  assert.equal(realLeave.payload.closed, false);
}

async function testRoomAnswersAreRedactedFromPublicFetches() {
  const code = makeCode(8123);
  await upsertRoom(makeRoom(code, {
    status: "in-progress",
    participants: [
      {
        id: "host-client",
        name: "Host",
        host: true,
        spectator: false,
        bot: false,
        active: true,
        muted: false,
        status: "submitted",
        answer: "Secret answer",
        submittedRound: 1,
        remainingTime: 12
      }
    ],
    game: {
      matchId: `${code}-match`,
      status: "playing",
      round: 1,
      setup: makeSetup(1),
      updatedAt: Date.now()
    }
  }));

  const publicRoom = await request("GET", `/api/rooms/${code}`, undefined, { cookie: "" });
  assert.equal(publicRoom.response.status, 200, publicRoom.payload.error);
  assert.equal(publicRoom.payload.room.participants[0].answer, "");

  const hostRoom = await getRoom(code);
  assert.equal(hostRoom.response.status, 200, hostRoom.payload.error);
  assert.equal(hostRoom.payload.room.participants[0].answer, "Secret answer");
}

async function testStaticSensitiveFilesAreForbidden() {
  for (const path of ["/.env", "/server.js", "/lib/backend-store.js", "/tests/room-integration.test.js", "/package.json"]) {
    const { response, payload } = await request("GET", path);
    assert.equal(response.status, 403, `${path} should be forbidden, got ${response.status}: ${payload}`);
  }
}

async function testImageProxyRejectsPrivateHosts() {
  for (const source of ["https://localhost/image.png", "https://127.0.0.1/image.png", "https://10.0.0.2/image.png", "http://example.com/image.png"]) {
    const { response } = await request("GET", `/api/image?src=${encodeURIComponent(source)}`);
    assert.equal(response.status, 400, `${source} should be rejected`);
  }
}

async function testSecurityHeadersAreApplied() {
  const staticResponse = await request("HEAD", "/index.html");
  assert.equal(staticResponse.response.status, 200);
  assert.equal(staticResponse.response.headers["X-Content-Type-Options"], "nosniff");
  assert.equal(staticResponse.response.headers["X-Frame-Options"], "SAMEORIGIN");
  assert.match(staticResponse.response.headers["Content-Security-Policy"], /default-src 'self'/);

  const apiResponse = await request("GET", "/api/auth/session");
  assert.equal(apiResponse.response.status, 200, apiResponse.payload.error);
  assert.equal(apiResponse.response.headers["X-Content-Type-Options"], "nosniff");
  assert.match(apiResponse.response.headers["Content-Security-Policy"], /connect-src 'self' https: wss:/);
}

async function testAdminLoginRateLimit() {
  const headers = { "x-forwarded-for": "203.0.113.44" };
  for (let index = 0; index < 8; index += 1) {
    const result = await request("POST", "/api/auth/admin/login", { token: `wrong-${index}` }, headers);
    assert.equal(result.response.status, 401, result.payload.error);
  }
  const limited = await request("POST", "/api/auth/admin/login", { token: "wrong-limited" }, headers);
  assert.equal(limited.response.status, 429);
  const retryAfter = Number(limited.response.headers["Retry-After"]);
  assert.ok(retryAfter > 0 && retryAfter <= 300);
}

async function testHostPageExitDeletesRoom() {
  const code = makeCode(8102);
  await upsertRoom(makeRoom(code));
  const { response, payload } = await roomLeaveCommand(code, {
    participantId: "host-client",
    reason: "page-exit"
  });
  assert.equal(response.status, 200, payload.error);
  assert.equal(payload.closed, true);
  assert.equal(payload.reason, "host-left");
  const rooms = await listRooms();
  assert.equal(rooms.some((entry) => entry.code === code), false);
}

async function testManualHostLeaveTransfersOwnershipAndAuthority() {
  const code = makeCode(8183);
  await upsertRoom(makeRoom(code));

  const oldest = await roomPresenceCommand(code, {
    participantId: "oldest-player",
    compact: true,
    participant: {
      id: "oldest-player",
      profileUserId: "user:oldest-player",
      name: "Oldest",
      host: false,
      spectator: false,
      bot: false,
      active: true,
      muted: false,
      status: "joined",
      joinedAt: 2
    }
  });
  assert.equal(oldest.response.status, 200, oldest.payload.error);

  const target = await roomPresenceCommand(code, {
    participantId: "target-player",
    compact: true,
    participant: {
      id: "target-player",
      profileUserId: "user:target-player",
      name: "Target",
      host: false,
      spectator: false,
      bot: false,
      active: true,
      muted: false,
      status: "joined",
      joinedAt: 3
    }
  });
  assert.equal(target.response.status, 200, target.payload.error);

  const left = await roomLeaveCommand(code, {
    participantId: "host-client",
    reason: "manual"
  });
  assert.equal(left.response.status, 200, left.payload.error);
  assert.equal(left.payload.closed, false);
  assert.equal(left.payload.eventType, "host-transferred");
  assert.equal(left.payload.newHostId, "oldest-player");

  const muted = await roomModerationCommand(code, {
    hostParticipantId: "oldest-player",
    participantId: "target-player",
    action: "mute"
  });
  assert.equal(muted.response.status, 200, muted.payload.error);
  assert.equal(muted.payload.participant.id, "target-player");
  assert.equal(muted.payload.participant.muted, true);

  const stored = await getRoom(code);
  assert.equal(stored.response.status, 200, stored.payload.error);
  assert.equal(stored.payload.room.host.id, "oldest-player");
  assert.equal(stored.payload.room.participants.find((participant) => participant.id === "host-client").active, false);
}

async function testPromotedHostLeavingClosesRoomWhenNoPlayersRemain() {
  const code = makeCode(8189);
  await upsertRoom(makeRoom(code, {
    participants: [
      {
        id: "host-client",
        name: "Host",
        host: true,
        spectator: false,
        bot: false,
        active: true,
        muted: false,
        status: "host",
        joinedAt: 1
      },
      {
        id: "oldest-player",
        profileUserId: "user:oldest-player",
        name: "Oldest",
        host: false,
        spectator: false,
        bot: false,
        active: true,
        muted: false,
        status: "joined",
        joinedAt: 2
      }
    ]
  }));

  const hostLeft = await roomLeaveCommand(code, {
    participantId: "host-client",
    reason: "manual"
  });
  assert.equal(hostLeft.response.status, 200, hostLeft.payload.error);
  assert.equal(hostLeft.payload.eventType, "host-transferred");
  assert.equal(hostLeft.payload.newHostId, "oldest-player");

  const promotedLeft = await roomLeaveCommand(code, {
    participantId: "oldest-player",
    reason: "manual"
  });
  assert.equal(promotedLeft.response.status, 200, promotedLeft.payload.error);
  assert.equal(promotedLeft.payload.closed, true);
  assert.equal(promotedLeft.payload.reason, "host-left");

  const directRoom = await getRoom(code);
  assert.equal(directRoom.response.status, 410);
  assert.equal(directRoom.payload.closed, true);
  assert.equal(directRoom.payload.close.reason, "host-left");
}

async function testHostReconnectTimeoutPromotesOldestPlayer() {
  const code = makeCode(8184);
  const expiredAt = Date.now() - 61_000;
  await upsertRoom(makeRoom(code, {
    hostExitPendingAt: expiredAt,
    participants: [
      {
        id: "host-client",
        profileUserId: "user:host-owner",
        name: "Host",
        host: true,
        spectator: false,
        bot: false,
        active: false,
        muted: false,
        status: "disconnected",
        disconnectedAt: expiredAt,
        joinedAt: 1
      },
      {
        id: "oldest-player",
        profileUserId: "user:oldest-player",
        name: "Oldest",
        host: false,
        spectator: false,
        bot: false,
        active: true,
        muted: false,
        status: "joined",
        joinedAt: 2
      },
      {
        id: "newest-player",
        profileUserId: "user:newest-player",
        name: "Newest",
        host: false,
        spectator: false,
        bot: false,
        active: true,
        muted: false,
        status: "joined",
        joinedAt: 3
      }
    ]
  }));

  const rooms = await listRooms();
  const room = rooms.find((entry) => entry.code === code);
  assert.ok(room, "Room should remain open after host handoff.");
  assert.equal(room.host.id, "oldest-player");
  assert.equal(room.host.name, "Oldest");
  assert.equal(room.hostExitPendingAt, 0);
  assert.equal(room.participants.find((participant) => participant.id === "oldest-player").host, true);
  assert.equal(room.participants.find((participant) => participant.id === "host-client").host, false);
  assert.equal(room.events.at(-1).type, "host_transferred");
  assert.equal(room.events.at(-1).payload.reason, "host-reconnect-timeout");
}

async function testCreatingSecondRoomTransfersOlderRoomHost() {
  const oldCode = makeCode(8187);
  const newCode = makeCode(8188);
  await upsertRoom(makeRoom(oldCode, {
    host: {
      id: "host-client",
      profileUserId: "user:host-owner",
      name: "Host",
      avatar: "",
      equippedTitleId: "",
      cardCustomization: null
    },
    participants: [
      {
        id: "host-client",
        profileUserId: "user:host-owner",
        name: "Host",
        host: true,
        spectator: false,
        bot: false,
        active: true,
        muted: false,
        status: "host",
        joinedAt: 1
      },
      {
        id: "oldest-player",
        profileUserId: "user:oldest-player",
        name: "Oldest",
        host: false,
        spectator: false,
        bot: false,
        active: true,
        muted: false,
        status: "joined",
        joinedAt: 2
      }
    ]
  }));

  const { response, payload } = await roomCommand(newCode, "create_room", {
    room: makeRoom(newCode, {
      host: {
        id: "new-host-client",
        profileUserId: "user:host-owner",
        name: "Host Again",
        avatar: "",
        equippedTitleId: "",
        cardCustomization: null
      },
      participants: [
        {
          id: "new-host-client",
          profileUserId: "user:host-owner",
          name: "Host Again",
          host: true,
          spectator: false,
          bot: false,
          active: true,
          muted: false,
          status: "host",
          joinedAt: 1
        }
      ]
    })
  }, {}, {
    participantId: "new-host-client"
  });
  assert.equal(response.status, 200, payload.error);
  assert.equal(payload.room.code, newCode);
  assert.equal(payload.transferredRooms.length, 1);
  assert.equal(payload.transferredRooms[0].code, oldCode);
  assert.equal(payload.transferredRooms[0].host.id, "oldest-player");
  assert.equal(payload.transferredRooms[0].activePlayers, 1);
  assert.equal(payload.transferredRooms[0].participants.find((participant) => participant.id === "host-client").active, false);

  const oldRoom = (await listRooms()).find((room) => room.code === oldCode);
  assert.equal(oldRoom.host.id, "oldest-player");
  assert.equal(oldRoom.events.at(-1).type, "host_transferred");
  assert.equal(oldRoom.events.at(-1).payload.reason, "host-created-another-room");
}

async function testAnswerSurvivesReconnectCommand() {
  const code = makeCode(8103);
  await upsertRoom(makeRoom(code, {
    status: "in-progress",
    participants: [
      {
        id: "host-client",
        name: "Host",
        avatar: "",
        equippedTitleId: "",
        cardCustomization: null,
        host: true,
        spectator: false,
        bot: false,
        active: true,
        muted: false,
        status: "submitted",
        answer: "Paris",
        submittedRound: 1,
        remainingTime: 12
      }
    ],
    game: {
      matchId: `${code}-match`,
      status: "playing",
      round: 1,
      setup: makeSetup(1),
      updatedAt: Date.now()
    }
  }));

  const { response, payload } = await roomCommand(code, "rejoin_room", {
    participantId: "host-client",
    participant: {
      id: "host-client",
      name: "Host",
      host: true,
      role: "host",
      active: true,
      status: "host"
    }
  });
  assert.equal(response.status, 200, payload.error);
  const host = payload.participant;
  assert.equal(host.answer, "Paris");
  assert.equal(host.submittedRound, 1);
  assert.equal(host.remainingTime, 12);
}

async function testLateJoinerReceivesRoundState() {
  const code = makeCode(8104);
  const game = {
    matchId: `${code}-match`,
    status: "playing",
    round: 1,
    setup: makeSetup(1),
    powerState: {
      updatedAt: Date.now(),
      hands: [
        {
          participantId: "host-client",
          owner: "player",
          hand: ["software_downgrade", "xray_hacks"],
          fresh: ["software_downgrade"]
        }
      ]
    },
    updatedAt: Date.now()
  };
  await upsertRoom(makeRoom(code, {
    status: "in-progress",
    game
  }));

  const presence = await roomPresenceCommand(code, {
    participant: {
      id: "joiner-client",
      name: "Joiner",
      active: true,
      status: "joined"
    }
  });
  assert.equal(presence.response.status, 200, presence.payload.error);
  assert.equal(presence.payload.room.status, "in-progress");
  assert.equal(presence.payload.room.game.round, 1);
  assert.equal(presence.payload.room.game.setup.blackCard, "Round 1 question?");
  assert.equal(presence.payload.room.game.powerState.hands[0].participantId, "host-client");
  assert.deepEqual(presence.payload.room.game.powerState.hands[0].hand, ["software_downgrade", "xray_hacks"]);
  assert.ok(presence.payload.room.revision >= 2);
  assert.equal(presence.payload.room.game.matchId, game.matchId);
  assert.equal(presence.payload.room.game.round, 1);
}

async function testRoomChatPreservesMessageIds() {
  const code = makeCode(8109);
  await upsertRoom(makeRoom(code));

  const { response, payload } = await roomChatCommand(code, {
    message: {
      id: "chat-test-message-1",
      sender: "Host",
      owner: "player",
      participantId: "host-client",
      text: "Hello room",
      createdAt: Date.now()
    }
  });
  assert.equal(response.status, 200, payload.error);
  assert.equal(payload.message.id, "chat-test-message-1");
  assert.equal(payload.room.chat.at(-1).id, "chat-test-message-1");
}

async function testCompactRoomDeltasAvoidFullRoomPayloads() {
  const code = makeCode(8110);
  await upsertRoom(makeRoom(code));

  const chatStartedAt = Date.now();
  const chat = await roomChatCommand(code, {
    compact: true,
    message: {
      id: "chat-compact-message-1",
      sender: "Fake Host",
      owner: "player",
      participantId: "host-client",
      host: false,
      spectator: true,
      text: "Compact hello",
      createdAt: 1
    }
  });
  assert.equal(chat.response.status, 200, chat.payload.error);
  assert.equal(chat.payload.message.id, "chat-compact-message-1");
  assert.equal(chat.payload.message.sender, "Host");
  assert.equal(chat.payload.message.host, true);
  assert.equal(chat.payload.message.spectator, false);
  assert.ok(chat.payload.revision >= 2);
  assert.ok(chat.payload.message.createdAt >= chatStartedAt);
  assert.equal(chat.payload.room, undefined);
  assert.ok(chat.payload.revision >= 2);

  const presence = await roomPresenceCommand(code, {
    compact: true,
    participant: {
      id: "compact-joiner",
      name: "Compact",
      active: true,
      status: "joined"
    }
  });
  assert.equal(presence.response.status, 200, presence.payload.error);
  assert.equal(presence.payload.participant.id, "compact-joiner");
  assert.equal(presence.payload.room, undefined);
  assert.ok(presence.payload.revision >= 3);
}

async function testCompactPresenceCanIncludeAuthoritativeRoomSnapshot() {
  const code = makeCode(8150);
  await upsertRoom(makeRoom(code));

  const presence = await roomPresenceCommand(code, {
    compact: true,
    includeRoom: true,
    participant: {
      id: "snapshot-joiner",
      profileUserId: "guest:snapshot-joiner",
      name: "Snapshot",
      active: true,
      status: "joined"
    }
  });
  assert.equal(presence.response.status, 200, presence.payload.error);
  assert.equal(presence.payload.participant.id, "snapshot-joiner");
  assert.equal(presence.payload.room.code, code);
  assert.equal(presence.payload.room.participants.some((participant) => participant.id === "snapshot-joiner"), true);
  assert.equal(presence.payload.room.activePlayers, 2);
}

async function testRoomCommandRejoinReclaimsSameTabActiveParticipant() {
  const code = makeCode(8191);
  const matchId = `${code}-match`;
  const created = await upsertRoom(makeRoom(code));

  const joined = await request("POST", `/api/rooms/${code}/commands`, {
    roomCode: code,
    participantId: "guest-client",
    clientInstanceId: "conn-a",
    tabSessionId: "tab-a",
    clientEventId: "join-same-tab-guest",
    expectedRevision: created.revision,
    type: "join_room",
    payload: {
      participantId: "guest-client",
      tabSessionId: "tab-a",
      participant: {
        id: "guest-client",
        profileUserId: "guest:guest-client",
        connectionId: "conn-a",
        tabSessionId: "tab-a",
        name: "Guest",
        active: true,
        status: "joined"
      }
    }
  });
  assert.equal(joined.response.status, 200, joined.payload.error);

  const seededActiveMatch = await upsertRoom(makeRoom(code, {
    status: "in-progress",
    participants: [
      {
        id: "host-client",
        profileUserId: "guest:host-client",
        name: "Host",
        host: true,
        active: true,
        status: "host"
      },
      {
        id: "guest-client",
        profileUserId: "guest:guest-client",
        connectionId: "conn-a",
        tabSessionId: "tab-a",
        name: "Guest",
        active: true,
        status: "submitted",
        answer: "Saved answer",
        submittedRound: 1,
        submissionMatchId: matchId,
        remainingTime: 12
      }
    ],
    game: {
      matchId,
      status: "playing",
      round: 1,
      setup: makeSetup(1),
      answers: {
        "guest-client": {
          answer: "Saved answer",
          status: "submitted",
          submittedAt: Date.now(),
          remainingTime: 12
        }
      },
      updatedAt: Date.now()
    }
  }));

  const rejoined = await request("POST", `/api/rooms/${code}/commands`, {
    roomCode: code,
    participantId: "guest-client",
    clientInstanceId: "conn-b",
    tabSessionId: "tab-a",
    clientEventId: "rejoin-same-tab-guest",
    expectedRevision: seededActiveMatch.revision,
    type: "rejoin_room",
    payload: {
      participantId: "guest-client",
      tabSessionId: "tab-a",
      participant: {
        id: "guest-client",
        profileUserId: "guest:guest-client",
        connectionId: "conn-b",
        tabSessionId: "tab-a",
        name: "Guest",
        active: true,
        status: "joined"
      }
    }
  });
  assert.equal(rejoined.response.status, 200, rejoined.payload.error);
  assert.equal(rejoined.payload.participant.connectionId, "conn-b");
  assert.equal(rejoined.payload.participant.tabSessionId, "tab-a");
  assert.equal(rejoined.payload.participant.status, "submitted");
  assert.equal(rejoined.payload.participant.answer, "Saved answer");
}

async function testRoomCommandRejectsDuplicateActiveParticipantTab() {
  const code = makeCode(8192);
  const created = await upsertRoom(makeRoom(code));

  const joined = await request("POST", `/api/rooms/${code}/commands`, {
    roomCode: code,
    participantId: "guest-client",
    clientInstanceId: "conn-a",
    tabSessionId: "tab-a",
    clientEventId: "join-duplicate-guest",
    expectedRevision: created.revision,
    type: "join_room",
    payload: {
      participantId: "guest-client",
      tabSessionId: "tab-a",
      participant: {
        id: "guest-client",
        profileUserId: "guest:guest-client",
        connectionId: "conn-a",
        tabSessionId: "tab-a",
        name: "Guest",
        active: true,
        status: "joined"
      }
    }
  });
  assert.equal(joined.response.status, 200, joined.payload.error);

  const duplicate = await request("POST", `/api/rooms/${code}/commands`, {
    roomCode: code,
    participantId: "guest-client",
    clientInstanceId: "conn-c",
    tabSessionId: "tab-b",
    clientEventId: "duplicate-active-guest",
    expectedRevision: joined.payload.revision,
    type: "rejoin_room",
    payload: {
      participantId: "guest-client",
      tabSessionId: "tab-b",
      participant: {
        id: "guest-client",
        profileUserId: "guest:guest-client",
        connectionId: "conn-c",
        tabSessionId: "tab-b",
        name: "Guest",
        active: true,
        status: "joined"
      }
    }
  });
  assert.equal(duplicate.response.status, 409);
  assert.equal(duplicate.payload.ok, false);
  assert.equal(duplicate.payload.duplicateParticipantId, "guest-client");

  const stored = await getRoom(code);
  assert.equal(stored.response.status, 200, stored.payload.error);
  const participant = stored.payload.room.participants.find((entry) => entry.id === "guest-client");
  assert.equal(participant.connectionId, "conn-a");
  assert.equal(participant.tabSessionId, "tab-a");
}

async function testRoomCommandRejoinRestoresDisconnectedSubmittedParticipant() {
  const code = makeCode(8193);
  const matchId = `${code}-match`;
  const created = await upsertRoom(makeRoom(code));

  const joined = await request("POST", `/api/rooms/${code}/commands`, {
    roomCode: code,
    participantId: "guest-client",
    clientInstanceId: "conn-a",
    tabSessionId: "tab-a",
    clientEventId: "join-disconnected-guest",
    expectedRevision: created.revision,
    type: "join_room",
    payload: {
      participantId: "guest-client",
      tabSessionId: "tab-a",
      participant: {
        id: "guest-client",
        profileUserId: "guest:guest-client",
        connectionId: "conn-a",
        tabSessionId: "tab-a",
        name: "Guest",
        active: true,
        status: "joined"
      }
    }
  });
  assert.equal(joined.response.status, 200, joined.payload.error);

  const seededActiveMatch = await upsertRoom(makeRoom(code, {
    status: "in-progress",
    participants: [
      {
        id: "host-client",
        profileUserId: "guest:host-client",
        name: "Host",
        host: true,
        active: true,
        status: "host"
      },
      {
        id: "guest-client",
        profileUserId: "guest:guest-client",
        connectionId: "conn-a",
        tabSessionId: "tab-a",
        name: "Guest",
        active: false,
        status: "disconnected",
        disconnectedAt: Date.now(),
        answer: "Saved answer",
        submittedRound: 1,
        submissionMatchId: matchId,
        remainingTime: 9
      }
    ],
    game: {
      matchId,
      status: "playing",
      round: 1,
      setup: makeSetup(1),
      answers: {
        "guest-client": {
          participantId: "guest-client",
          answer: "Saved answer",
          status: "submitted",
          submittedAt: Date.now(),
          remainingTime: 9,
          matchId,
          round: 1
        }
      },
      updatedAt: Date.now()
    }
  }));

  const rejoined = await request("POST", `/api/rooms/${code}/commands`, {
    roomCode: code,
    participantId: "guest-client",
    clientInstanceId: "conn-b",
    tabSessionId: "tab-a",
    clientEventId: "rejoin-disconnected-guest",
    expectedRevision: seededActiveMatch.revision,
    type: "rejoin_room",
    payload: {
      participantId: "guest-client",
      tabSessionId: "tab-a",
      participant: {
        id: "guest-client",
        profileUserId: "guest:guest-client",
        connectionId: "conn-b",
        tabSessionId: "tab-a",
        name: "Guest",
        active: true,
        status: "joined"
      }
    }
  });
  assert.equal(rejoined.response.status, 200, rejoined.payload.error);
  assert.equal(rejoined.payload.participant.active, true);
  assert.equal(rejoined.payload.participant.status, "submitted");
  assert.equal(rejoined.payload.participant.answer, "Saved answer");
  assert.equal(rejoined.payload.events.some((event) => event.type === "participant_reconnected"), true);
}

async function testRoomCommandHostRejoinPreservesActiveMatchState() {
  const code = makeCode(8194);
  const matchId = `${code}-match`;
  const created = await upsertRoom(makeRoom(code, {
    status: "in-progress",
    hostExitPendingAt: Date.now(),
    participants: [
      {
        id: "host-client",
        profileUserId: "guest:host-client",
        connectionId: "host-conn-a",
        tabSessionId: "host-tab-a",
        name: "Host",
        host: true,
        active: false,
        status: "host-disconnected",
        disconnectedAt: Date.now()
      },
      {
        id: "guest-client",
        profileUserId: "guest:guest-client",
        connectionId: "guest-conn-a",
        tabSessionId: "guest-tab-a",
        name: "Guest",
        active: true,
        status: "waiting"
      }
    ],
    game: {
      matchId,
      status: "playing",
      round: 3,
      setup: makeSetup(3),
      answers: {},
      updatedAt: Date.now()
    }
  }));

  const rejoined = await request("POST", `/api/rooms/${code}/commands`, {
    roomCode: code,
    participantId: "host-client",
    clientInstanceId: "host-conn-b",
    tabSessionId: "host-tab-a",
    clientEventId: "host-rejoin-active-match",
    expectedRevision: created.revision,
    type: "rejoin_room",
    payload: {
      participantId: "host-client",
      tabSessionId: "host-tab-a",
      participant: {
        id: "host-client",
        profileUserId: "guest:host-client",
        connectionId: "host-conn-b",
        tabSessionId: "host-tab-a",
        name: "Host",
        host: true,
        role: "host",
        active: true,
        status: "host"
      }
    }
  });
  assert.equal(rejoined.response.status, 200, rejoined.payload.error);
  assert.equal(rejoined.payload.participant.host, true);
  assert.equal(rejoined.payload.participant.active, true);
  assert.equal(rejoined.payload.participant.connectionId, "host-conn-b");
  assert.equal(rejoined.payload.participant.status, "host");

  const stored = await getRoom(code);
  assert.equal(stored.response.status, 200, stored.payload.error);
  assert.equal(stored.payload.room.status, "in-progress");
  assert.equal(stored.payload.room.host.id, "host-client");
  assert.equal(stored.payload.room.hostExitPendingAt, 0);
  assert.equal(stored.payload.room.game.matchId, matchId);
  assert.equal(stored.payload.room.game.round, 3);
}

async function testRoomCommandLobbyRejoinPreservesPlayerSlot() {
  const code = makeCode(8195);
  const created = await upsertRoom(makeRoom(code, {
    participants: [
      {
        id: "host-client",
        profileUserId: "guest:host-client",
        name: "Host",
        host: true,
        active: true,
        status: "host"
      },
      {
        id: "guest-client",
        profileUserId: "guest:guest-client",
        connectionId: "guest-conn-a",
        tabSessionId: "guest-tab-a",
        name: "Guest",
        active: false,
        status: "disconnected",
        disconnectedAt: Date.now()
      }
    ]
  }));

  const rejoined = await request("POST", `/api/rooms/${code}/commands`, {
    roomCode: code,
    participantId: "guest-client",
    clientInstanceId: "guest-conn-b",
    tabSessionId: "guest-tab-a",
    clientEventId: "lobby-rejoin-player",
    expectedRevision: created.revision,
    type: "rejoin_room",
    payload: {
      participantId: "guest-client",
      tabSessionId: "guest-tab-a",
      participant: {
        id: "guest-client",
        profileUserId: "guest:guest-client",
        connectionId: "guest-conn-b",
        tabSessionId: "guest-tab-a",
        name: "Guest",
        active: true,
        status: "joined"
      }
    }
  });
  assert.equal(rejoined.response.status, 200, rejoined.payload.error);
  assert.equal(rejoined.payload.participant.active, true);
  assert.equal(rejoined.payload.participant.status, "joined");
  assert.equal(rejoined.payload.events.some((event) => event.type === "participant_reconnected"), true);

  const stored = await getRoom(code);
  assert.equal(stored.response.status, 200, stored.payload.error);
  assert.equal(stored.payload.room.participants.filter((participant) => participant.id === "guest-client").length, 1);
  assert.equal(stored.payload.room.activePlayers, 2);
}

async function testRoomCommandRejoinRestoresWaitingParticipantDuringAnswerPhase() {
  const code = makeCode(8196);
  const matchId = `${code}-match`;
  const created = await upsertRoom(makeRoom(code, {
    status: "in-progress",
    participants: [
      {
        id: "host-client",
        profileUserId: "guest:host-client",
        name: "Host",
        host: true,
        active: true,
        status: "host"
      },
      {
        id: "guest-client",
        profileUserId: "guest:guest-client",
        connectionId: "guest-conn-a",
        tabSessionId: "guest-tab-a",
        name: "Guest",
        active: false,
        status: "waiting",
        disconnectedAt: Date.now()
      }
    ],
    game: {
      matchId,
      status: "playing",
      round: 2,
      setup: makeSetup(2),
      answers: {},
      updatedAt: Date.now()
    }
  }));

  const rejoined = await request("POST", `/api/rooms/${code}/commands`, {
    roomCode: code,
    participantId: "guest-client",
    clientInstanceId: "guest-conn-b",
    tabSessionId: "guest-tab-a",
    clientEventId: "answer-waiting-rejoin-player",
    expectedRevision: created.revision,
    type: "rejoin_room",
    payload: {
      participantId: "guest-client",
      tabSessionId: "guest-tab-a",
      participant: {
        id: "guest-client",
        profileUserId: "guest:guest-client",
        connectionId: "guest-conn-b",
        tabSessionId: "guest-tab-a",
        name: "Guest",
        active: true,
        status: "joined"
      }
    }
  });
  assert.equal(rejoined.response.status, 200, rejoined.payload.error);
  assert.equal(rejoined.payload.participant.status, "waiting");
  assert.equal(rejoined.payload.participant.submittedRound, 0);
}

async function testRoomCommandRejoinRestoresSubmittedParticipantDuringGrading() {
  const code = makeCode(8197);
  const matchId = `${code}-match`;
  const created = await upsertRoom(makeRoom(code, {
    status: "in-progress",
    participants: [
      {
        id: "host-client",
        profileUserId: "guest:host-client",
        name: "Host",
        host: true,
        active: true,
        status: "host"
      },
      {
        id: "guest-client",
        profileUserId: "guest:guest-client",
        connectionId: "guest-conn-a",
        tabSessionId: "guest-tab-a",
        name: "Guest",
        active: false,
        status: "disconnected",
        disconnectedAt: Date.now()
      }
    ],
    game: {
      matchId,
      status: "grading",
      round: 4,
      setup: makeSetup(4),
      answers: {
        "guest-client": {
          participantId: "guest-client",
          answer: "Grading answer",
          status: "submitted",
          submittedAt: Date.now(),
          remainingTime: 5,
          matchId,
          round: 4
        }
      },
      updatedAt: Date.now()
    }
  }));

  const rejoined = await request("POST", `/api/rooms/${code}/commands`, {
    roomCode: code,
    participantId: "guest-client",
    clientInstanceId: "guest-conn-b",
    tabSessionId: "guest-tab-a",
    clientEventId: "grading-rejoin-player",
    expectedRevision: created.revision,
    type: "rejoin_room",
    payload: {
      participantId: "guest-client",
      tabSessionId: "guest-tab-a",
      participant: {
        id: "guest-client",
        profileUserId: "guest:guest-client",
        connectionId: "guest-conn-b",
        tabSessionId: "guest-tab-a",
        name: "Guest",
        active: true,
        status: "joined"
      }
    }
  });
  assert.equal(rejoined.response.status, 200, rejoined.payload.error);
  assert.equal(rejoined.payload.participant.status, "submitted");
  assert.equal(rejoined.payload.participant.answer, "Grading answer");
  assert.equal(rejoined.payload.participant.submittedRound, 4);
  assert.equal(rejoined.payload.participant.submissionMatchId, matchId);
}

async function testSpectatorPresenceDoesNotConsumePlayerSlot() {
  const code = makeCode(8111);
  await upsertRoom(makeRoom(code));

  const { response, payload } = await roomPresenceCommand(code, {
    participant: {
      id: "spectator-client",
      name: "Spectator",
      active: true,
      spectator: true,
      status: "spectating"
    }
  });
  assert.equal(response.status, 200, payload.error);
  assert.equal(payload.room.activePlayers, 1);
  assert.equal(payload.room.spectators, 1);
  assert.equal(payload.room.participants.some((participant) => participant.id === "spectator-client" && participant.spectator), true);
}

async function testSpectatorLeaveUpdatesAuthoritativeRoomSnapshot() {
  const code = makeCode(8151);
  await upsertRoom(makeRoom(code, {
    participants: [
      {
        id: "host-client",
        name: "Host",
        host: true,
        spectator: false,
        bot: false,
        active: true,
        muted: false,
        status: "host"
      },
      {
        id: "spectator-leaver",
        profileUserId: "guest:spectator-leaver",
        name: "Watcher",
        host: false,
        spectator: true,
        bot: false,
        active: true,
        muted: false,
        status: "spectating"
      }
    ]
  }));

  const leave = await roomLeaveCommand(code, {
    participantId: "spectator-leaver",
    reason: "manual"
  });
  assert.equal(leave.response.status, 200, leave.payload.error);
  assert.equal(leave.payload.closed, false);
  assert.equal(leave.payload.room.code, code);
  assert.equal(leave.payload.room.spectators, 0);
  assert.equal(leave.payload.room.activePlayers, 1);
  assert.equal(leave.payload.room.participants.some((participant) => participant.id === "spectator-leaver"), false);
}

async function testParticipantWithoutActiveDefaultsActiveAndRole() {
  const code = makeCode(8145);
  await upsertRoom(makeRoom(code));

  const { response, payload } = await roomPresenceCommand(code, {
    participant: {
      id: "implicit-active-client",
      name: "Implicit",
      status: "joined"
    }
  });
  assert.equal(response.status, 200, payload.error);
  const participant = payload.room.participants.find((entry) => entry.id === "implicit-active-client");
  assert.equal(participant.active, true);
  assert.equal(participant.role, "player");
  assert.equal(payload.room.activePlayers, 2);
  assert.equal(payload.room.spectators, 0);
}

async function testSpectatorCannotSubmitGameplayAnswer() {
  const code = makeCode(8146);
  const matchId = `${code}-match`;
  await upsertRoom(makeRoom(code, {
    status: "in-progress",
    game: {
      matchId,
      status: "playing",
      round: 1,
      setup: makeSetup(1),
      updatedAt: Date.now()
    }
  }));

  const join = await roomPresenceCommand(code, {
    compact: true,
    participant: {
      id: "spectator-submit-client",
      profileUserId: "guest:spectator-submit",
      name: "Watcher",
      spectator: true,
      active: true,
      status: "spectating"
    }
  });
  assert.equal(join.response.status, 200, join.payload.error);
  assert.equal(join.payload.participant.role, "spectator");

  const submit = await roomPresenceCommand(code, {
    compact: true,
    participant: {
      id: "spectator-submit-client",
      profileUserId: "guest:spectator-submit",
      name: "Watcher",
      active: true,
      status: "submitted",
      answer: "Answer",
      submittedRound: 1,
      submissionMatchId: matchId,
      remainingTime: 18
    }
  });
  assert.equal(submit.response.status, 403);

  const stored = await getRoom(code);
  assert.equal(stored.response.status, 200, stored.payload.error);
  const spectator = stored.payload.room.participants.find((entry) => entry.id === "spectator-submit-client");
  assert.equal(spectator.role, "spectator");
  assert.equal(spectator.answer, "");
  assert.equal(spectator.submittedRound, 0);
  assert.equal(stored.payload.room.activePlayers, 1);
  assert.equal(stored.payload.room.spectators, 1);
}

async function testDuplicateHostPresenceRemovesStaleHostRow() {
  const code = makeCode(8114);
  await upsertRoom(makeRoom(code, {
    host: {
      id: "old-host-client",
      name: "Host",
      avatar: "",
      equippedTitleId: "",
      cardCustomization: null
    },
    participants: [
      {
        id: "old-host-client",
        name: "Host",
        host: true,
        spectator: false,
        bot: false,
        active: true,
        muted: false,
        status: "host"
      }
    ]
  }));

  const { response, payload } = await roomPresenceCommand(code, {
    participant: {
      id: "new-host-client",
      name: "Host",
      host: true,
      spectator: false,
      bot: false,
      active: true,
      muted: false,
      status: "host"
    }
  });
  assert.equal(response.status, 200, payload.error);
  assert.equal(payload.room.host.id, "new-host-client");
  assert.equal(payload.room.participants.filter((participant) => participant.host).length, 1);
  assert.equal(payload.room.participants.some((participant) => participant.id === "old-host-client"), false);
  assert.equal(payload.room.activePlayers, 1);
}

async function testRoomSettingsPatchPreservesParticipantsChatAndGame() {
  const code = makeCode(8112);
  await upsertRoom(makeRoom(code, {
    participants: [
      {
        id: "host-client",
        name: "Host",
        host: true,
        spectator: false,
        bot: false,
        active: true,
        muted: false,
        status: "host"
      },
      {
        id: "settings-joiner",
        name: "Joiner",
        active: true,
        status: "joined"
      }
    ],
    chat: [
      {
      id: "settings-preserve-chat",
      sender: "Host",
      owner: "player",
      participantId: "host-client",
      text: "Preserve me",
      createdAt: Date.now()
      }
    ],
    game: {
      matchId: `${code}-match`,
      status: "playing",
      round: 1,
      setup: makeSetup(1),
      updatedAt: Date.now()
    }
  }));

  const { response, payload } = await roomSettingsCommand(code, {
    hostParticipantId: "host-client",
    status: "lobby",
    settings: {
      rounds: 7,
      timerSeconds: 45,
      maxPlayers: 6,
      autoAdvance: false,
      enabledThemes: ["Science"]
    }
  });
  assert.equal(response.status, 200, payload.error);
  assert.equal(payload.settings.rounds, 7);
  assert.equal(payload.settings.autoAdvance, false);
  assert.ok(payload.revision >= 2);

  const stored = await getRoom(code);
  assert.equal(stored.response.status, 200, stored.payload.error);
  assert.equal(stored.payload.room.settings.timerSeconds, 45);
  assert.equal(stored.payload.room.settings.autoAdvance, false);
  assert.equal(stored.payload.room.chat.some((message) => message.id === "settings-preserve-chat"), true);
  assert.equal(stored.payload.room.participants.some((participant) => participant.id === "settings-joiner"), true);
  assert.equal(stored.payload.room.game.setup.blackCard, "Round 1 question?");
  assert.equal(stored.payload.room.events.some((event) => event.type === "settings_updated"), true);
}

async function testRoomSettingsClassicModeNormalization() {
  const code = makeCode(8119);
  await upsertRoom(makeRoom(code, {
    settings: {
      ...makeRoom(code).settings,
      chaos: true,
      harsh: true,
      randomModifiers: true,
      classicMode: false
    }
  }));

  const classic = await roomSettingsCommand(code, {
    hostParticipantId: "host-client",
    settings: {
      classicMode: true,
      chaos: true,
      harsh: true,
      randomModifiers: true,
      enabledThemes: ["Science"]
    }
  });
  assert.equal(classic.response.status, 200, classic.payload.error);
  assert.equal(classic.payload.settings.classicMode, true);
  assert.equal(classic.payload.settings.chaos, false);
  assert.equal(classic.payload.settings.harsh, false);
  assert.equal(classic.payload.settings.randomModifiers, false);

  const modifiers = await roomSettingsCommand(code, {
    hostParticipantId: "host-client",
    settings: {
      classicMode: false,
      chaos: true,
      harsh: false,
      randomModifiers: false,
      enabledThemes: ["Science"]
    }
  });
  assert.equal(modifiers.response.status, 200, modifiers.payload.error);
  assert.equal(modifiers.payload.settings.classicMode, false);
  assert.equal(modifiers.payload.settings.chaos, true);

  const stored = await getRoom(code);
  assert.equal(stored.response.status, 200, stored.payload.error);
  assert.equal(stored.payload.room.settings.classicMode, false);
  assert.equal(stored.payload.room.settings.chaos, true);
}

async function testRoomPowerStateEndpointStampsEvents() {
  const code = makeCode(8113);
  await upsertRoom(makeRoom(code, {
    status: "in-progress",
    game: {
      matchId: `${code}-match`,
      status: "playing",
      round: 1,
      setup: makeSetup(1),
      powerState: {
        matchId: `${code}-match`,
        updatedAt: 2000,
        hands: [
          { participantId: "host-client", owner: "player", updatedAt: 2000, hand: ["software_downgrade", "xray_hacks"], fresh: [] }
        ],
        played: [],
        players: [],
        effects: { maps: {}, arrays: {}, values: {} }
      },
      updatedAt: Date.now()
    }
  }));
  const { response, payload } = await roomPowerStateCommand(code, {
    round: 1,
    powerId: "software_downgrade",
    actorParticipantId: "host-client",
    hands: [
      {
        participantId: "host-client",
        owner: "player",
        hand: ["xray_hacks"],
        fresh: []
      }
    ],
    played: [
      {
        participantId: "host-client",
        owner: "player",
        stacks: [{ powerId: "software_downgrade", revealId: "test-reveal", meta: {} }],
        primaryPowerId: "software_downgrade"
      }
    ],
    players: [{ participantId: "host-client", owner: "player", score: 100, streak: 2 }],
    effects: { maps: {}, arrays: {}, values: {} }
  });
  assert.equal(response.status, 200, payload.error);
  assert.equal(payload.hands[0].hand[0], "xray_hacks");
  assert.ok(payload.revision >= 2);

  const events = await request("GET", `/api/rooms/${code}/events?since=0`);
  assert.equal(events.response.status, 200, events.payload.error);
  const powerEvents = events.payload.events.filter((event) => event.payload?.powerId === "software_downgrade");
  assert.deepEqual(powerEvents.map((event) => event.type), ["power_state"]);
}

async function testAdminRoomPowerDebugRequiresAdminAndPublishesCanonicalPowerState() {
  const code = makeCode(8095);
  const matchId = `${code}-match`;
  await upsertRoom(makeRoom(code, {
    status: "in-progress",
    participants: [
      {
        id: "host-client",
        name: "Host",
        host: true,
        spectator: false,
        bot: false,
        active: true,
        muted: false,
        status: "host"
      },
      {
        id: "guest-client",
        name: "Guest",
        host: false,
        spectator: false,
        bot: false,
        active: true,
        muted: false,
        status: "joined"
      }
    ],
    game: {
      matchId,
      status: "playing",
      round: 1,
      setup: makeSetup(1),
      powerState: {
        matchId,
        updatedAt: 1000,
        hands: [
          { participantId: "host-client", owner: "player", updatedAt: 1000, hand: ["shuffle"], fresh: [] },
          { participantId: "guest-client", owner: "opponent", updatedAt: 1000, hand: [], fresh: [] }
        ],
        played: [],
        players: [
          { participantId: "host-client", owner: "player", updatedAt: 1000, score: 100, streak: 1 },
          { participantId: "guest-client", owner: "opponent", updatedAt: 1000, score: 200, streak: 2 }
        ],
        effects: { maps: {}, arrays: {}, values: {} }
      },
      updatedAt: Date.now()
    }
  }));

  const payload = {
    matchId,
    round: 1,
    operation: "add_power",
    targetParticipantId: "guest-client",
    hands: [
      { participantId: "host-client", owner: "player", updatedAt: 2000, hand: ["shuffle"], fresh: [] },
      { participantId: "guest-client", owner: "opponent", updatedAt: 2000, hand: ["xray_hacks"], fresh: ["xray_hacks"] }
    ],
    played: [],
    players: [
      { participantId: "host-client", owner: "player", updatedAt: 2000, score: 100, streak: 1 },
      { participantId: "guest-client", owner: "opponent", updatedAt: 2000, score: 200, streak: 2 }
    ],
    effects: { maps: {}, arrays: {}, values: {} }
  };
  const unauthorized = await roomAdminPowerDebugCommand(code, payload);
  assert.equal(unauthorized.response.status, 401);

  const result = await roomAdminPowerDebugCommand(code, payload, adminHeaders());
  assert.equal(result.response.status, 200, result.payload.error);
  assert.equal(result.payload.eventType, "power-state");
  assert.equal(result.payload.debugOperation, "add_power");
  assert.equal(result.payload.adminDebug, true);
  assert.ok(result.payload.powerRevision >= 1);
  assert.deepEqual(
    result.payload.powerState.hands.find((entry) => entry.participantId === "guest-client")?.hand,
    ["xray_hacks"]
  );

  const stored = await getRoom(code);
  assert.equal(stored.response.status, 200, stored.payload.error);
  assert.deepEqual(
    stored.payload.room.game.powerState.hands.find((entry) => entry.participantId === "guest-client")?.hand,
    ["xray_hacks"]
  );
  const events = await request("GET", `/api/rooms/${code}/events?since=0`);
  assert.equal(events.response.status, 200, events.payload.error);
  const event = events.payload.events.find((entry) => entry.type === "power_state" && entry.payload?.adminDebug);
  assert.ok(event);
  assert.equal(event.payload.targetParticipantId, "guest-client");
}

async function testEveryAvailablePowerUsesCanonicalMultiplayerTransport() {
  const powerIds = getMultiplayerPowerTransportTestIds();
  assert.ok(powerIds.length >= 100, "The power transport suite must cover the full available deck.");
  const previousRateLimitDisabled = process.env.RATE_LIMIT_DISABLED;
  process.env.RATE_LIMIT_DISABLED = "true";
  try {
    for (const [index, powerId] of powerIds.entries()) {
    const code = makeCode(8600 + index);
    const matchId = `${code}-match`;
    await upsertRoom(makeRoom(code, {
      status: "in-progress",
      participants: [
        {
          id: "host-client",
          name: "Host",
          host: true,
          spectator: false,
          bot: false,
          active: true,
          muted: false,
          status: "host"
        },
        {
          id: "guest-client",
          name: "Guest",
          host: false,
          spectator: false,
          bot: false,
          active: true,
          muted: false,
          status: "joined"
        }
      ],
      game: {
        matchId,
        status: "playing",
        round: 1,
        setup: makeSetup(1),
        powerState: {
          matchId,
          updatedAt: 1000,
          hands: [
            { participantId: "host-client", owner: "player", updatedAt: 1000, hand: [powerId], fresh: [powerId] },
            { participantId: "guest-client", owner: "opponent", updatedAt: 1000, hand: [], fresh: [] }
          ],
          played: [],
          players: [
            { participantId: "host-client", owner: "player", updatedAt: 1000, score: 10000, streak: 5 },
            { participantId: "guest-client", owner: "opponent", updatedAt: 1000, score: 5000, streak: 4 }
          ],
          effects: { maps: {}, arrays: {}, values: {} }
        },
        updatedAt: Date.now()
      }
    }));

    const result = await roomPowerStateCommand(code, {
      matchId,
      round: 1,
      powerId,
      actorParticipantId: "host-client",
      targetParticipantId: "guest-client",
      hands: [
        { participantId: "host-client", owner: "player", updatedAt: 2000, hand: [], fresh: [] },
        { participantId: "guest-client", owner: "opponent", updatedAt: 2000, hand: [], fresh: [] }
      ],
      played: [
        {
          participantId: "host-client",
          owner: "player",
          updatedAt: 2000,
          stacks: [{ powerId, revealId: `transport-${powerId}`, meta: { targetOwner: "opponent" } }],
          primaryPowerId: powerId,
          meta: { targetOwner: "opponent" }
        }
      ],
      players: [
        { participantId: "host-client", owner: "player", updatedAt: 2000, score: 10000, streak: 5 },
        { participantId: "guest-client", owner: "opponent", updatedAt: 2000, score: 5000, streak: 4 }
      ],
      effects: { maps: {}, arrays: {}, values: {} },
      action: {
        version: 1,
        type: "use",
        powerId,
        actorParticipantId: "host-client",
        targetParticipantId: "guest-client",
        matchId,
        round: 1,
        meta: { targetOwner: "opponent" }
      }
    });
    assert.equal(result.response.status, 200, `${powerId}: ${result.payload.error || "power command failed"}`);
    assert.equal(result.payload.eventType, "power-state", `${powerId}: no canonical power event`);
    assert.ok(result.payload.powerRevision >= 1, `${powerId}: no power revision`);
    assert.equal(
      result.payload.powerState.hands.find((entry) => entry.participantId === "host-client")?.hand.includes(powerId),
      false,
      `${powerId}: remained in the authoritative hand after use`
    );
    assert.equal(
      result.payload.powerState.played.find((entry) => entry.participantId === "host-client")?.stacks.some((entry) => entry.powerId === powerId),
      true,
      `${powerId}: missing from authoritative played history`
    );
    }
  } finally {
    if (previousRateLimitDisabled === undefined) {
      delete process.env.RATE_LIMIT_DISABLED;
    } else {
      process.env.RATE_LIMIT_DISABLED = previousRateLimitDisabled;
    }
  }
}

async function testRoomPowerStateRejectsPowerMissingFromAuthoritativeHand() {
  const code = makeCode(8186);
  await upsertRoom(makeRoom(code, {
    status: "in-progress",
    game: {
      matchId: `${code}-match`,
      status: "playing",
      round: 1,
      setup: makeSetup(1),
      powerState: {
        matchId: `${code}-match`,
        updatedAt: 2000,
        hands: [
          { participantId: "host-client", owner: "player", updatedAt: 2000, hand: ["shuffle"], fresh: [] }
        ],
        played: [],
        players: [],
        effects: { maps: {}, arrays: {}, values: {} }
      },
      updatedAt: Date.now()
    }
  }));

  const { response, payload } = await roomPowerStateCommand(code, {
    matchId: `${code}-match`,
    round: 1,
    powerId: "software_downgrade",
    actorParticipantId: "host-client",
    hands: [
      { participantId: "host-client", owner: "player", hand: ["shuffle"], fresh: [] }
    ],
    played: [
      {
        participantId: "host-client",
        owner: "player",
        stacks: [{ powerId: "software_downgrade", revealId: "forged-power", meta: {} }],
        primaryPowerId: "software_downgrade"
      }
    ]
  });
  assert.equal(response.status, 409);
  assert.equal(payload.ok, false);
  assert.match(payload.error, /authoritative hand/i);
}

async function testRoomPowerStateRejectsInvalidTargetParticipant() {
  const code = makeCode(8187);
  await upsertRoom(makeRoom(code, {
    status: "in-progress",
    game: {
      matchId: `${code}-match`,
      status: "playing",
      round: 1,
      setup: makeSetup(1),
      powerState: {
        matchId: `${code}-match`,
        updatedAt: 2000,
        hands: [
          { participantId: "host-client", owner: "player", updatedAt: 2000, hand: ["software_downgrade"], fresh: [] }
        ],
        played: [],
        players: [],
        effects: { maps: {}, arrays: {}, values: {} }
      },
      updatedAt: Date.now()
    }
  }));

  const { response, payload } = await roomPowerStateCommand(code, {
    matchId: `${code}-match`,
    round: 1,
    powerId: "software_downgrade",
    actorParticipantId: "host-client",
    targetParticipantId: "missing-target",
    hands: [
      { participantId: "host-client", owner: "player", hand: [], fresh: [] }
    ],
    played: [
      {
        participantId: "host-client",
        owner: "player",
        stacks: [{ powerId: "software_downgrade", revealId: "invalid-target", meta: {} }],
        primaryPowerId: "software_downgrade"
      }
    ]
  });
  assert.equal(response.status, 404);
  assert.equal(payload.ok, false);
  assert.match(payload.error, /target/i);
}

async function testRoomPowerStateTimeBenderUpdatesSharedTimers() {
  const code = makeCode(8171);
  const matchId = `${code}-match`;
  const roundStartedAt = Date.now() - 10000;
  const hostEndsAt = roundStartedAt + 30000;
  const guestEndsAt = roundStartedAt + 30000;
  await upsertRoom(makeRoom(code, {
    status: "in-progress",
    participants: [
      {
        id: "host-client",
        name: "Host",
        host: true,
        spectator: false,
        bot: false,
        active: true,
        muted: false,
        status: "host"
      },
      {
        id: "guest-client",
        name: "Guest",
        host: false,
        spectator: false,
        bot: false,
        active: true,
        muted: false,
        status: "joined"
      },
      {
        id: "spectator-client",
        name: "Spectator",
        host: false,
        spectator: true,
        bot: false,
        active: true,
        muted: false,
        status: "spectating"
      }
    ],
    game: {
      matchId,
      status: "playing",
      round: 1,
      setup: makeSetup(1),
      roundStartedAt,
      baseDurationMs: 30000,
      participantTimers: {
        "host-client": { endsAt: hostEndsAt, speedMultiplier: 1, status: "running" },
        "guest-client": { endsAt: guestEndsAt, speedMultiplier: 1, status: "running" }
      },
      gradingForceAt: guestEndsAt + 2000,
      powerState: {
        matchId,
        updatedAt: 2000,
        hands: [
          { participantId: "host-client", owner: "player", updatedAt: 2000, hand: ["time_bender"], fresh: [] },
          { participantId: "guest-client", owner: "opponent", updatedAt: 2000, hand: ["shuffle"], fresh: [] }
        ],
        played: [],
        players: [],
        effects: { maps: {}, arrays: {}, values: {} }
      },
      updatedAt: Date.now()
    }
  }));

  const { response, payload } = await roomPowerStateCommand(code, {
    matchId,
    round: 1,
    powerId: "time_bender",
    actorParticipantId: "host-client",
    timerAction: { type: "time_bender" },
    hands: [
      { participantId: "host-client", owner: "player", hand: [], fresh: [] }
    ],
    played: [
      {
        participantId: "host-client",
        owner: "player",
        stacks: [{ powerId: "time_bender", revealId: "test-time-bender", meta: {} }],
        primaryPowerId: "time_bender"
      }
    ]
  });
  assert.equal(response.status, 200, payload.error);
  assert.ok(payload.timerState);
  assert.equal(payload.timerState.participantTimers["host-client"].status, "running");
  assert.equal(payload.timerState.participantTimers["guest-client"].speedMultiplier, 2);
  assert.equal(payload.timerState.participantTimers["spectator-client"], undefined);
  assert.ok(payload.timerState.participantTimers["host-client"].endsAt >= hostEndsAt + 4000);
  assert.ok(payload.timerState.participantTimers["guest-client"].endsAt <= guestEndsAt - 8000);
  assert.ok(payload.timerState.gradingForceAt >= payload.timerState.participantTimers["host-client"].endsAt);

  const stored = await getRoom(code);
  assert.equal(stored.response.status, 200, stored.payload.error);
  assert.deepEqual(stored.payload.room.game.participantTimers, payload.timerState.participantTimers);

  const events = await request("GET", `/api/rooms/${code}/events?since=0`);
  assert.equal(events.response.status, 200, events.payload.error);
  const event = events.payload.events.find((entry) => entry.type === "power_state" && entry.payload.powerId === "time_bender");
  assert.ok(event);
  assert.equal(event.payload.timerState.participantTimers["guest-client"].speedMultiplier, 2);
}

async function testServerPowerEngineDerivesActionStateAndIsIdempotent() {
  const code = makeCode(8172);
  const matchId = `${code}-match`;
  const roundStartedAt = Date.now() - 5000;
  const clientEventId = "server-engine-time-bender-1";
  await upsertRoom(makeRoom(code, {
    status: "in-progress",
    game: {
      matchId,
      status: "playing",
      round: 1,
      setup: makeSetup(1),
      roundStartedAt,
      baseDurationMs: 30000,
      participantTimers: {
        "host-client": { endsAt: roundStartedAt + 30000, speedMultiplier: 1, status: "running" }
      },
      gradingForceAt: roundStartedAt + 32000,
      powerState: {
        matchId,
        updatedAt: roundStartedAt,
        hands: [
          { participantId: "host-client", owner: "player", hand: ["time_bender", "shuffle"], fresh: ["time_bender"] }
        ],
        played: [],
        players: [{ participantId: "host-client", owner: "player", score: 100, streak: 2 }],
        effects: { maps: {}, arrays: {}, values: { protected: true } }
      },
      updatedAt: Date.now()
    }
  }));

  const actionBody = {
    clientEventId,
    matchId,
    round: 1,
    powerId: "time_bender",
    actorParticipantId: "host-client",
    action: {
      version: 1,
      type: "use",
      powerId: "time_bender",
      actorParticipantId: "host-client",
      matchId,
      round: 1
    },
    // These values are intentionally forged. The migrated action must use the
    // server's previous power state for the actor hand, played card, score,
    // and effects instead of accepting this result patch.
    hands: [{ participantId: "host-client", owner: "player", hand: ["forged"], fresh: [] }],
    played: [{
      participantId: "host-client",
      owner: "player",
      stacks: [{ powerId: "shuffle", revealId: "forged", meta: {} }],
      primaryPowerId: "shuffle"
    }],
    players: [{ participantId: "host-client", owner: "player", score: 999999, streak: 99 }],
    effects: { maps: {}, arrays: {}, values: { forged: true } }
  };

  const first = await roomPowerStateCommand(code, actionBody);
  assert.equal(first.response.status, 200, first.payload.error);
  assert.equal(first.payload.serverAuthoritative, true);
  const firstHand = first.payload.powerState.hands.find((entry) => entry.participantId === "host-client");
  assert.deepEqual(firstHand.hand, ["shuffle"]);
  assert.deepEqual(firstHand.fresh, []);
  const firstPlayed = first.payload.powerState.played.find((entry) => entry.participantId === "host-client");
  assert.equal(firstPlayed.primaryPowerId, "time_bender");
  assert.equal(firstPlayed.stacks[0].powerId, "time_bender");
  assert.equal(firstPlayed.stacks[0].meta.serverResolved, true);
  assert.equal(first.payload.powerState.players[0].score, 100);
  assert.equal(first.payload.powerState.players[0].streak, 2);
  assert.equal(first.payload.powerState.effects.values.protected, true);
  assert.ok(first.payload.timerState);

  const storedAfterFirst = await getRoom(code);
  assert.equal(storedAfterFirst.response.status, 200, storedAfterFirst.payload.error);
  const firstRevision = storedAfterFirst.payload.room.revision;
  const duplicate = await roomPowerStateCommand(code, actionBody);
  assert.equal(duplicate.response.status, 200, duplicate.payload.error);
  assert.equal(duplicate.payload.duplicate, true);
  const storedAfterDuplicate = await getRoom(code);
  assert.equal(storedAfterDuplicate.payload.room.revision, firstRevision);

  const secondUse = await roomPowerStateCommand(code, {
    ...actionBody,
    clientEventId: "server-engine-time-bender-2"
  });
  assert.equal(secondUse.response.status, 409);
  assert.match(secondUse.payload.error, /authoritative hand|already been used/i);
}

async function testServerPowerEngineDerivesScoreStealFromStoredPlayers() {
  const code = makeCode(8182);
  const matchId = `${code}-match`;
  await upsertRoom(makeRoom(code, {
    status: "in-progress",
    participants: [
      {
        id: "host-client",
        name: "Host",
        host: true,
        spectator: false,
        bot: false,
        active: true,
        muted: false,
        status: "playing"
      },
      {
        id: "guest-client",
        name: "Guest",
        host: false,
        spectator: false,
        bot: false,
        active: true,
        muted: false,
        status: "playing"
      }
    ],
    game: {
      matchId,
      status: "playing",
      round: 1,
      setup: makeSetup(1),
      powerState: {
        matchId,
        updatedAt: Date.now() - 1000,
        hands: [
          { participantId: "host-client", owner: "player", hand: ["shameless"], fresh: ["shameless"] },
          { participantId: "guest-client", owner: "opponent", hand: [], fresh: [] }
        ],
        played: [],
        players: [
          { participantId: "host-client", owner: "player", score: 1000, streak: 1 },
          { participantId: "guest-client", owner: "opponent", score: 4000, streak: 2 }
        ],
        effects: { maps: {}, arrays: {}, values: {} }
      },
      updatedAt: Date.now()
    }
  }));

  const result = await roomPowerStateCommand(code, {
    clientEventId: "server-engine-shameless-1",
    matchId,
    round: 1,
    powerId: "shameless",
    actorParticipantId: "host-client",
    targetParticipantId: "guest-client",
    action: {
      version: 1,
      type: "use",
      powerId: "shameless",
      actorParticipantId: "host-client",
      targetParticipantId: "guest-client",
      matchId,
      round: 1
    },
    hands: [{ participantId: "host-client", owner: "player", hand: ["forged"], fresh: [] }],
    played: [],
    players: [
      { participantId: "host-client", owner: "player", score: 999999, streak: 99 },
      { participantId: "guest-client", owner: "opponent", score: 1, streak: 0 }
    ],
    effects: { maps: {}, arrays: {}, values: { forged: true } }
  });
  assert.equal(result.response.status, 200, result.payload.error);
  assert.equal(result.payload.serverAuthoritative, true);
  const hostPlayer = result.payload.powerState.players.find((entry) => entry.participantId === "host-client");
  const guestPlayer = result.payload.powerState.players.find((entry) => entry.participantId === "guest-client");
  assert.equal(hostPlayer.score, 1200);
  assert.equal(guestPlayer.score, 3800);
  const played = result.payload.powerState.played.find((entry) => entry.participantId === "host-client");
  assert.equal(played.primaryPowerId, "shameless");
  assert.equal(played.meta.stolenAmount, 200);
}

async function testServerPowerEngineCalculatesChaosVariantSeparately() {
  const code = makeCode(8183);
  const matchId = `${code}-match`;
  await upsertRoom(makeRoom(code, {
    status: "in-progress",
    participants: [
      {
        id: "host-client",
        name: "Host",
        host: true,
        spectator: false,
        bot: false,
        active: true,
        muted: false,
        status: "playing"
      },
      {
        id: "guest-client",
        name: "Guest",
        host: false,
        spectator: false,
        bot: false,
        active: true,
        muted: false,
        status: "playing"
      },
      {
        id: "bot-client",
        name: "Bot",
        host: false,
        spectator: false,
        bot: true,
        role: "bot",
        active: true,
        muted: false,
        status: "bot"
      }
    ],
    game: {
      matchId,
      status: "playing",
      round: 1,
      setup: makeSetup(1),
      powerState: {
        matchId,
        updatedAt: Date.now() - 1000,
        hands: [
          { participantId: "host-client", owner: "player", hand: ["lightning_strike__chaos"], fresh: ["lightning_strike__chaos"] },
          { participantId: "guest-client", owner: "opponent", hand: [], fresh: [] },
          { participantId: "bot-client", owner: "bot-1", hand: [], fresh: [] }
        ],
        played: [],
        players: [
          { participantId: "host-client", owner: "player", score: 1000, streak: 1 },
          { participantId: "guest-client", owner: "opponent", score: 5000, streak: 3 },
          { participantId: "bot-client", owner: "bot-1", score: 2000, streak: 2 }
        ],
        effects: { maps: {}, arrays: {}, values: {} }
      },
      updatedAt: Date.now()
    }
  }));

  const result = await roomPowerStateCommand(code, {
    clientEventId: "server-engine-chaos-lightning-1",
    matchId,
    round: 1,
    powerId: "lightning_strike__chaos",
    actorParticipantId: "host-client",
    action: {
      version: 1,
      type: "use",
      powerId: "lightning_strike__chaos",
      actorParticipantId: "host-client",
      matchId,
      round: 1
    },
    players: [
      { participantId: "host-client", owner: "player", score: 999999, streak: 99 },
      { participantId: "guest-client", owner: "opponent", score: 999999, streak: 99 },
      { participantId: "bot-client", owner: "bot-1", score: 999999, streak: 99 }
    ]
  });
  assert.equal(result.response.status, 200, result.payload.error);
  assert.equal(result.payload.serverAuthoritative, true);
  const hostPlayer = result.payload.powerState.players.find((entry) => entry.participantId === "host-client");
  const guestPlayer = result.payload.powerState.players.find((entry) => entry.participantId === "guest-client");
  const botPlayer = result.payload.powerState.players.find((entry) => entry.participantId === "bot-client");
  assert.equal(hostPlayer.score, 1000);
  assert.equal(guestPlayer.score, 1250);
  assert.equal(botPlayer.score, 0);
  const played = result.payload.powerState.played.find((entry) => entry.participantId === "host-client");
  assert.equal(played.primaryPowerId, "lightning_strike__chaos");
  assert.deepEqual(new Set(played.meta.affectedParticipantIds), new Set(["guest-client", "bot-client"]));
  assert.equal(played.meta.appliedLoss, 6750);
}

async function testServerPowerEngineHardResetUsesStoredStreakProtections() {
  const code = makeCode(8184);
  const matchId = `${code}-match`;
  await upsertRoom(makeRoom(code, {
    status: "in-progress",
    participants: [
      {
        id: "host-client",
        name: "Host",
        host: true,
        spectator: false,
        bot: false,
        active: true,
        muted: false,
        status: "playing"
      },
      {
        id: "guest-client",
        name: "Guest",
        host: false,
        spectator: false,
        bot: false,
        active: true,
        muted: false,
        status: "playing"
      }
    ],
    game: {
      matchId,
      status: "playing",
      round: 1,
      setup: makeSetup(1),
      powerState: {
        matchId,
        updatedAt: Date.now() - 1000,
        hands: [
          { participantId: "host-client", owner: "player", hand: ["hard_reset"], fresh: ["hard_reset"] },
          { participantId: "guest-client", owner: "opponent", hand: [], fresh: [] }
        ],
        played: [],
        players: [
          { participantId: "host-client", owner: "player", score: 1000, streak: 2 },
          { participantId: "guest-client", owner: "opponent", score: 1000, streak: 4 }
        ],
        effects: {
          maps: {
            streakAnchorCharges: { opponent: 1 }
          },
          arrays: {},
          values: {}
        }
      },
      updatedAt: Date.now()
    }
  }));

  const result = await roomPowerStateCommand(code, {
    clientEventId: "server-engine-hard-reset-1",
    matchId,
    round: 1,
    powerId: "hard_reset",
    actorParticipantId: "host-client",
    action: {
      version: 1,
      type: "use",
      powerId: "hard_reset",
      actorParticipantId: "host-client",
      matchId,
      round: 1
    },
    players: [
      { participantId: "host-client", owner: "player", score: 999999, streak: 99 },
      { participantId: "guest-client", owner: "opponent", score: 999999, streak: 99 }
    ]
  });
  assert.equal(result.response.status, 200, result.payload.error);
  const hostPlayer = result.payload.powerState.players.find((entry) => entry.participantId === "host-client");
  const guestPlayer = result.payload.powerState.players.find((entry) => entry.participantId === "guest-client");
  assert.equal(hostPlayer.streak, 0);
  assert.equal(guestPlayer.streak, 4);
  assert.equal(result.payload.powerState.effects.maps.streakAnchorCharges.opponent, undefined);
  const played = result.payload.powerState.played.find((entry) => entry.participantId === "host-client");
  assert.deepEqual(played.meta.resetParticipantIds, ["host-client"]);
}

async function testStaleRoomRoundResultCannotOverwriteRematch() {
  const code = makeCode(8116);
  await upsertRoom(makeRoom(code, {
    status: "in-progress",
    game: {
      matchId: `${code}-new-match`,
      status: "playing",
      round: 1,
      setup: makeSetup(1),
      updatedAt: Date.now()
    }
  }));

  const stale = await roomRoundResultCommand(code, {
    hostParticipantId: "host-client",
    roundResult: makeRoundResult(1, { matchId: `${code}-old-match`, questionId: "old-question" })
  });
  assert.equal(stale.response.status, 409);

  const stored = await getRoom(code);
  assert.equal(stored.response.status, 200, stored.payload.error);
  assert.equal(stored.payload.room.status, "in-progress");
  assert.equal(stored.payload.room.game.matchId, `${code}-new-match`);
  assert.equal(stored.payload.room.game.roundResult, null);
}

async function testStaleRoomGameEndCannotCompleteRematch() {
  const code = makeCode(8117);
  await upsertRoom(makeRoom(code, {
    status: "in-progress",
    game: {
      matchId: `${code}-new-match`,
      status: "starting",
      round: 1,
      setup: null,
      updatedAt: Date.now()
    }
  }));

  const stale = await roomGameCommand(code, {
    hostParticipantId: "host-client",
    game: {
      matchId: `${code}-old-match`,
      status: "ended",
      round: 10,
      setup: makeSetup(10),
      updatedAt: Date.now()
    }
  });
  assert.equal(stale.response.status, 409);

  const stored = await getRoom(code);
  assert.equal(stored.response.status, 200, stored.payload.error);
  assert.equal(stored.payload.room.status, "in-progress");
  assert.equal(stored.payload.room.game.matchId, `${code}-new-match`);
  assert.equal(stored.payload.room.game.status, "starting");
}

async function testRoomReturnToLobbyClearsMatchState() {
  const code = makeCode(8119);
  const matchId = `${code}-match`;
  await upsertRoom(makeRoom(code, {
    status: "complete",
    participants: [
      {
        id: "host-client",
        name: "Host",
        host: true,
        spectator: false,
        bot: false,
        active: true,
        muted: false,
        status: "submitted",
        answer: "Host answer",
        submittedRound: 3,
        submissionMatchId: matchId,
        remainingTime: 12
      },
      {
        id: "guest-client",
        name: "Guest",
        host: false,
        spectator: false,
        bot: false,
        active: true,
        muted: false,
        status: "submitted",
        answer: "Guest answer",
        submittedRound: 3,
        submissionMatchId: matchId,
        remainingTime: 6
      },
      {
        id: "spectator-client",
        name: "Watcher",
        host: false,
        spectator: true,
        bot: false,
        active: true,
        muted: false,
        status: "spectating",
        answer: "Spectator answer",
        submittedRound: 3,
        submissionMatchId: matchId,
        remainingTime: 4
      }
    ],
    game: {
      matchId,
      status: "ended",
      round: 3,
      setup: makeSetup(3),
      answers: {
        "host-client": { participantId: "host-client", answer: "Host answer", status: "submitted", matchId, round: 3 },
        "guest-client": { participantId: "guest-client", answer: "Guest answer", status: "submitted", matchId, round: 3 }
      },
      roundResult: makeRoundResult(3, { matchId }),
      participantTimers: {
        "host-client": { endsAt: Date.now() + 1000, speedMultiplier: 1, status: "ended" }
      },
      updatedAt: Date.now()
    }
  }));

  const returned = await roomLobbyCommand(code, {
    hostParticipantId: "host-client",
    matchId
  });
  assert.equal(returned.response.status, 200, returned.payload.error);
  assert.equal(returned.payload.eventType, "room-updated");
  assert.equal(returned.payload.room.status, "lobby");
  assert.equal(returned.payload.room.game, null);

  const host = returned.payload.room.participants.find((participant) => participant.id === "host-client");
  const guest = returned.payload.room.participants.find((participant) => participant.id === "guest-client");
  const spectator = returned.payload.room.participants.find((participant) => participant.id === "spectator-client");
  assert.equal(host.status, "host");
  assert.equal(guest.status, "joined");
  assert.equal(spectator.status, "spectating");
  [host, guest, spectator].forEach((participant) => {
    assert.equal(participant.answer, "");
    assert.equal(participant.submittedRound, 0);
    assert.equal(participant.submissionMatchId, "");
    assert.equal(participant.remainingTime, 0);
  });

  const stored = await getRoom(code);
  assert.equal(stored.response.status, 200, stored.payload.error);
  assert.equal(stored.payload.room.status, "lobby");
  assert.equal(stored.payload.room.game, null);
  assert.equal(stored.payload.room.events.some((event) => event.type === "room_updated" && event.payload?.previousMatchId === matchId), true);
}

async function testStaleParticipantSubmissionCannotOverwriteRematch() {
  const code = makeCode(8118);
  await upsertRoom(makeRoom(code, {
    status: "in-progress",
    participants: [
      {
        id: "host-client",
        name: "Host",
        host: true,
        spectator: false,
        bot: false,
        active: true,
        muted: false,
        status: "submitted",
        answer: "Current answer",
        submittedRound: 1,
        submissionMatchId: `${code}-new-match`,
        remainingTime: 20
      }
    ],
    game: {
      matchId: `${code}-new-match`,
      status: "playing",
      round: 1,
      setup: makeSetup(1),
      updatedAt: Date.now()
    }
  }));

  const stale = await roomPresenceCommand(code, {
    compact: true,
    participant: {
      id: "host-client",
      name: "Host",
      host: true,
      active: true,
      status: "submitted",
      answer: "Old MCQ option",
      submittedRound: 1,
      submissionMatchId: `${code}-old-match`,
      remainingTime: 3
    }
  });
  assert.equal(stale.response.status, 409);

  const stored = await getRoom(code);
  assert.equal(stored.response.status, 200, stored.payload.error);
  const host = stored.payload.room.participants.find((participant) => participant.id === "host-client");
  assert.equal(host.answer, "Current answer");
  assert.equal(host.submittedRound, 1);
  assert.equal(host.submissionMatchId, `${code}-new-match`);
  assert.equal(host.remainingTime, 20);

  const missingMatchId = await roomPresenceCommand(code, {
    participant: {
      id: "host-client",
      name: "Host",
      host: true,
      active: true,
      status: "submitted",
      answer: "No match id answer",
      submittedRound: 1,
      remainingTime: 2
    }
  });
  assert.equal(missingMatchId.response.status, 409);

  const afterMissingMatchId = await getRoom(code);
  assert.equal(afterMissingMatchId.response.status, 200, afterMissingMatchId.payload.error);
  const guardedHost = afterMissingMatchId.payload.room.participants.find((participant) => participant.id === "host-client");
  assert.equal(guardedHost.answer, "Current answer");
  assert.equal(guardedHost.submittedRound, 1);
  assert.equal(guardedHost.submissionMatchId, `${code}-new-match`);
  assert.equal(guardedHost.remainingTime, 20);
}

async function testStaleParticipantSubmissionCannotOverwriteCurrentRound() {
  const code = makeCode(8131);
  const matchId = `${code}-match`;
  await upsertRoom(makeRoom(code, {
    status: "in-progress",
    participants: [
      {
        id: "host-client",
        name: "Host",
        host: true,
        spectator: false,
        bot: false,
        active: true,
        muted: false,
        status: "submitted",
        answer: "Current round answer",
        submittedRound: 2,
        submissionMatchId: matchId,
        remainingTime: 18
      }
    ],
    game: {
      matchId,
      status: "playing",
      round: 2,
      setup: makeSetup(2),
      updatedAt: Date.now()
    }
  }));

  const stale = await roomPresenceCommand(code, {
    compact: true,
    participant: {
      id: "host-client",
      name: "Host",
      host: true,
      active: true,
      status: "submitted",
      answer: "Previous round answer",
      submittedRound: 1,
      submissionMatchId: matchId,
      remainingTime: 2
    }
  });
  assert.equal(stale.response.status, 409);

  const stored = await getRoom(code);
  assert.equal(stored.response.status, 200, stored.payload.error);
  const host = stored.payload.room.participants.find((participant) => participant.id === "host-client");
  assert.equal(host.answer, "Current round answer");
  assert.equal(host.submittedRound, 2);
  assert.equal(host.submissionMatchId, matchId);
  assert.equal(host.remainingTime, 18);
}

async function testCurrentRoundSubmissionIsAnswerEvent() {
  const code = makeCode(8132);
  const matchId = `${code}-match`;
  await upsertRoom(makeRoom(code, {
    status: "in-progress",
    participants: [
      {
        id: "host-client",
        name: "Host",
        host: true,
        active: true,
        status: "host"
      },
      {
        id: "guest-client",
        name: "Guest",
        active: true,
        status: "joined"
      }
    ],
    game: {
      matchId,
      status: "playing",
      round: 2,
      setup: makeSetup(2),
      updatedAt: Date.now()
    }
  }));

  const submitted = await roomPresenceCommand(code, {
    compact: true,
    participant: {
      id: "host-client",
      name: "Host",
      host: true,
      active: true,
      status: "submitted",
      answer: "Fresh answer",
      submittedRound: 2,
      submissionMatchId: matchId,
      remainingTime: 12
    }
  });
  assert.equal(submitted.response.status, 200, submitted.payload.error);
  assert.equal(submitted.payload.eventType, "answer-submitted");
  assert.equal(submitted.payload.matchId, matchId);
  assert.equal(submitted.payload.round, 2);
  assert.equal(submitted.payload.answer, "Fresh answer");

  const events = await request("GET", `/api/rooms/${code}/events?since=0`);
  assert.equal(events.response.status, 200, events.payload.error);
  const answerEvent = events.payload.events.find((event) => event.type === "answer_submitted");
  assert.ok(answerEvent);
  assert.equal(answerEvent.revision, submitted.payload.revision);
  assert.equal(answerEvent.payload.matchId, matchId);
  assert.equal(answerEvent.payload.round, 2);
}

async function testRoomAnswerEndpointStoresRoundScopedAnswer() {
  const code = makeCode(8162);
  const matchId = `${code}-match`;
  const roundStartedAt = Date.now() - 5000;
  await upsertRoom(makeRoom(code, {
    status: "in-progress",
    participants: [
      {
        id: "host-client",
        name: "Host",
        host: true,
        spectator: false,
        bot: false,
        active: true,
        muted: false,
        status: "host"
      },
      {
        id: "guest-client",
        name: "Guest",
        host: false,
        spectator: false,
        bot: false,
        active: true,
        muted: false,
        status: "joined"
      }
    ],
    game: {
      matchId,
      status: "playing",
      round: 2,
      setup: makeSetup(2),
      answers: {},
      roundStartedAt,
      baseDurationMs: 30000,
      participantTimers: {
        "host-client": { endsAt: roundStartedAt + 30000, speedMultiplier: 1, status: "running" },
        "guest-client": { endsAt: roundStartedAt + 30000, speedMultiplier: 1, status: "running" }
      },
      gradingForceAt: roundStartedAt + 32000,
      updatedAt: Date.now()
    }
  }));

  const submitted = await roomAnswerCommand(code, {
    participantId: "host-client",
    matchId,
    round: 2,
    answer: "Fresh endpoint answer",
    remainingTime: 11
  });
  assert.equal(submitted.response.status, 200, submitted.payload.error);
  assert.equal(submitted.payload.eventType, "answer-submitted");
  assert.equal(submitted.payload.matchId, matchId);
  assert.equal(submitted.payload.round, 2);
  assert.equal(submitted.payload.answer, "Fresh endpoint answer");
  assert.equal(submitted.payload.remainingTime, 11);
  assert.equal(submitted.payload.submissionStatus, "submitted");

  const duplicate = await roomAnswerCommand(code, {
    participantId: "host-client",
    matchId,
    round: 2,
    answer: "Different duplicate answer",
    remainingTime: 1
  });
  assert.equal(duplicate.response.status, 200, duplicate.payload.error);
  assert.equal(duplicate.payload.duplicate, true);
  assert.equal(duplicate.payload.answer, "Fresh endpoint answer");
  assert.equal(duplicate.payload.remainingTime, 11);

  const hostCookieKey = `cai_room_host_${code.replace(/[^A-Z0-9]/g, "_")}`;
  const previousHostCookie = cookieJar.get(hostCookieKey);
  cookieJar.delete(hostCookieKey);
  const stored = await getRoom(code);
  if (previousHostCookie) {
    cookieJar.set(hostCookieKey, previousHostCookie);
  }
  assert.equal(stored.response.status, 200, stored.payload.error);
  const host = stored.payload.room.participants.find((participant) => participant.id === "host-client");
  assert.equal(host.answer, "");
  assert.equal(stored.payload.room.game.answers["host-client"].answer, "");
  assert.equal(stored.payload.room.game.answers["host-client"].round, 2);
  assert.equal(stored.payload.room.game.participantTimers["host-client"].status, "ended");
  assert.equal(stored.payload.room.game.participantTimers["guest-client"].status, "running");

  const events = await request("GET", `/api/rooms/${code}/events?since=0`);
  assert.equal(events.response.status, 200, events.payload.error);
  const answerEvent = events.payload.events.find((event) => event.type === "answer_submitted");
  assert.ok(answerEvent);
  assert.equal(answerEvent.payload.answer, "Fresh endpoint answer");
  assert.equal(answerEvent.payload.matchId, matchId);
  assert.equal(answerEvent.payload.round, 2);
}

async function testRoomAnswerEndpointRejectsStaleRoundAndTimedOutState() {
  const code = makeCode(8163);
  const matchId = `${code}-match`;
  await upsertRoom(makeRoom(code, {
    status: "in-progress",
    game: {
      matchId,
      status: "playing",
      round: 3,
      setup: makeSetup(3),
      answers: {},
      updatedAt: Date.now()
    }
  }));

  const stale = await roomAnswerCommand(code, {
    participantId: "host-client",
    matchId,
    round: 2,
    answer: "Old answer",
    remainingTime: 4
  });
  assert.equal(stale.response.status, 409);

  const timedOut = await roomAnswerCommand(code, {
    participantId: "host-client",
    matchId,
    round: 3,
    answer: "",
    remainingTime: 0,
    timedOut: true
  });
  assert.equal(timedOut.response.status, 200, timedOut.payload.error);
  assert.equal(timedOut.payload.submissionStatus, "timed_out");
  assert.equal(timedOut.payload.autoSubmitted, true);

  const stored = await getRoom(code);
  assert.equal(stored.response.status, 200, stored.payload.error);
  assert.equal(stored.payload.room.game.answers["host-client"].status, "timed_out");
  assert.equal(stored.payload.room.game.answers["host-client"].answer, "");
}

async function testRoomAnswerEndpointStartsGradingWhenAllSubmitted() {
  const code = makeCode(8164);
  const matchId = `${code}-match`;
  await upsertRoom(makeRoom(code, {
    status: "in-progress",
    participants: [
      {
        id: "host-client",
        name: "Host",
        host: true,
        spectator: false,
        bot: false,
        active: true,
        muted: false,
        status: "host"
      },
      {
        id: "guest-client",
        name: "Guest",
        host: false,
        spectator: false,
        bot: false,
        active: true,
        muted: false,
        status: "joined"
      }
    ],
    game: {
      matchId,
      status: "playing",
      round: 2,
      setup: makeSetup(2),
      answers: {},
      updatedAt: Date.now()
    }
  }));

  const first = await roomAnswerCommand(code, {
    participantId: "host-client",
    matchId,
    round: 2,
    answer: "Host answer",
    remainingTime: 12
  });
  assert.equal(first.response.status, 200, first.payload.error);
  assert.equal(first.payload.grading, undefined);
  assert.deepEqual(first.payload.submissionStatusSnapshot.submittedParticipantIds, ["host-client"]);
  assert.deepEqual(first.payload.submissionStatusSnapshot.pendingParticipantIds, ["guest-client"]);
  assert.equal(first.payload.submissionStatusSnapshot.allSubmitted, false);

  const second = await roomAnswerCommand(code, {
    participantId: "guest-client",
    hostParticipantId: "host-client",
    matchId,
    round: 2,
    answer: "Guest answer",
    remainingTime: 9
  });
  assert.equal(second.response.status, 200, second.payload.error);
  assert.equal(second.payload.grading.eventType, "round-grading");
  assert.equal(second.payload.grading.reason, "all-submitted");
  assert.equal(second.payload.grading.submissions.length, 2);
  assert.deepEqual(new Set(second.payload.submissionStatusSnapshot.submittedParticipantIds), new Set(["host-client", "guest-client"]));
  assert.deepEqual(second.payload.submissionStatusSnapshot.pendingParticipantIds, []);
  assert.equal(second.payload.submissionStatusSnapshot.allSubmitted, true);

  const stored = await getRoom(code);
  assert.equal(stored.response.status, 200, stored.payload.error);
  assert.equal(stored.payload.room.game.status, "grading");
  assert.equal(stored.payload.room.game.answers["host-client"].answer, "Host answer");
  assert.equal(stored.payload.room.game.answers["guest-client"].answer, "Guest answer");
  assert.equal(stored.payload.room.events.some((event) => event.type === "round_grading"), true);
}

async function testHostSubmittedBotAnswerCanStartGrading() {
  const code = makeCode(8174);
  const matchId = `${code}-match`;
  await upsertRoom(makeRoom(code, {
    status: "in-progress",
    participants: [
      {
        id: "host-client",
        name: "Host",
        host: true,
        spectator: false,
        bot: false,
        active: true,
        muted: false,
        status: "submitted",
        answer: "Host answer",
        submittedRound: 1,
        submissionMatchId: matchId,
        remainingTime: 12
      },
      {
        id: "bot-client",
        name: "Bot",
        host: false,
        spectator: false,
        bot: true,
        role: "bot",
        active: true,
        muted: false,
        status: "bot"
      }
    ],
    game: {
      matchId,
      status: "playing",
      round: 1,
      setup: makeSetup(1),
      answers: {
        "host-client": {
          participantId: "host-client",
          matchId,
          round: 1,
          status: "submitted",
          answer: "Host answer",
          remainingTime: 12,
          submittedAt: Date.now() - 1000
        }
      },
      updatedAt: Date.now()
    }
  }));

  const botAnswer = await request("POST", `/api/rooms/${code}/commands`, {
    type: "submit_answer",
    roomCode: code,
    participantId: "bot-client",
    clientEventId: `${code}:bot-submit`,
    payload: {
      participantId: "bot-client",
      hostParticipantId: "host-client",
      matchId,
      round: 1,
      answer: "Bot answer",
      remainingTime: 8,
      autoSubmitted: true
    }
  });
  assert.equal(botAnswer.response.status, 200, botAnswer.payload.error);
  assert.equal(botAnswer.payload.events.some((event) => event.type === "answer_submitted" && event.payload.participantId === "bot-client"), true);
  assert.equal(botAnswer.payload.events.some((event) => event.type === "round_grading"), true);

  const stored = await getRoom(code);
  assert.equal(stored.response.status, 200, stored.payload.error);
  assert.equal(stored.payload.room.game.status, "grading");
  assert.equal(stored.payload.room.game.answers["bot-client"].answer, "Bot answer");
}

async function testHostLastAfterSubmittedBotsStartsGrading() {
  const code = makeCode(8176);
  const matchId = `${code}-match`;
  await upsertRoom(makeRoom(code, {
    status: "in-progress",
    participants: [
      {
        id: "host-client",
        name: "Host",
        host: true,
        spectator: false,
        bot: false,
        active: true,
        muted: false,
        status: "playing"
      },
      {
        id: "bot-one",
        name: "Bot One",
        host: false,
        spectator: false,
        bot: true,
        role: "bot",
        active: true,
        muted: false,
        status: "submitted",
        answer: "Bot one answer",
        submittedRound: 1,
        submissionMatchId: matchId,
        remainingTime: 7
      },
      {
        id: "bot-two",
        name: "Bot Two",
        host: false,
        spectator: false,
        bot: true,
        role: "bot",
        active: true,
        muted: false,
        status: "submitted",
        answer: "Bot two answer",
        submittedRound: 1,
        submissionMatchId: matchId,
        remainingTime: 5
      }
    ],
    game: {
      matchId,
      status: "playing",
      round: 1,
      setup: makeSetup(1),
      answers: {
        "bot-one": {
          participantId: "bot-one",
          matchId,
          round: 1,
          status: "submitted",
          answer: "Bot one answer",
          remainingTime: 7,
          submittedAt: Date.now() - 2000
        },
        "bot-two": {
          participantId: "bot-two",
          matchId,
          round: 1,
          status: "submitted",
          answer: "Bot two answer",
          remainingTime: 5,
          submittedAt: Date.now() - 1500
        }
      },
      updatedAt: Date.now()
    }
  }));

  const hostAnswer = await roomAnswerCommand(code, {
    participantId: "host-client",
    matchId,
    round: 1,
    answer: "Host answer",
    remainingTime: 12
  });
  assert.equal(hostAnswer.response.status, 200, hostAnswer.payload.error);
  assert.equal(hostAnswer.payload.events.some((event) => event.type === "answer_submitted" && event.payload.participantId === "host-client"), true);
  assert.equal(hostAnswer.payload.grading.eventType, "round-grading");
  assert.equal(hostAnswer.payload.grading.submissions.length, 3);

  const stored = await getRoom(code);
  assert.equal(stored.response.status, 200, stored.payload.error);
  assert.equal(stored.payload.room.game.status, "grading");
  assert.equal(stored.payload.room.game.answers["host-client"].answer, "Host answer");
  assert.equal(stored.payload.room.events.filter((event) => event.type === "round_grading").length, 1);
}

async function testHostSubmissionAutoSubmitsBotsAndStartsGrading() {
  const code = makeCode(8175);
  const matchId = `${code}-match`;
  await upsertRoom(makeRoom(code, {
    status: "in-progress",
    participants: [
      {
        id: "host-client",
        name: "Host",
        host: true,
        spectator: false,
        bot: false,
        active: true,
        muted: false,
        status: "playing"
      },
      {
        id: "bot-client",
        name: "Bot",
        host: false,
        spectator: false,
        bot: true,
        role: "bot",
        active: true,
        muted: false,
        status: "bot"
      }
    ],
    game: {
      matchId,
      status: "playing",
      round: 1,
      setup: {
        ...makeSetup(1),
        botAnswerPool: ["Bot auto answer", "Wrong"],
        botWrongPool: ["Wrong"]
      },
      answers: {},
      updatedAt: Date.now()
    }
  }));

  const hostAnswer = await roomAnswerCommand(code, {
    participantId: "host-client",
    matchId,
    round: 1,
    answer: "Host answer",
    remainingTime: 15
  });
  assert.equal(hostAnswer.response.status, 200, hostAnswer.payload.error);
  assert.equal(hostAnswer.payload.events.some((event) => event.type === "answer_submitted" && event.payload.participantId === "host-client"), true);
  assert.equal(hostAnswer.payload.events.some((event) => event.type === "answer_submitted" && event.payload.participantId === "bot-client" && event.payload.autoSubmitted === true), true);
  assert.equal(hostAnswer.payload.grading.eventType, "round-grading");
  assert.equal(hostAnswer.payload.grading.submissions.length, 2);
  assert.deepEqual(new Set(hostAnswer.payload.submissionStatusSnapshot.submittedParticipantIds), new Set(["host-client", "bot-client"]));
  assert.deepEqual(hostAnswer.payload.submissionStatusSnapshot.pendingParticipantIds, []);
  assert.equal(hostAnswer.payload.submissionStatusSnapshot.allSubmitted, true);

  const stored = await getRoom(code);
  assert.equal(stored.response.status, 200, stored.payload.error);
  assert.equal(stored.payload.room.game.status, "grading");
  assert.equal(stored.payload.room.game.answers["host-client"].answer, "Host answer");
  assert.equal(stored.payload.room.game.answers["bot-client"].autoSubmitted, true);
}

async function testBotOnlyRoomSkipAutoSubmitsBotsAndStartsGrading() {
  const code = makeCode(8178);
  const matchId = `${code}-match`;
  await upsertRoom(makeRoom(code, {
    status: "in-progress",
    participants: [
      {
        id: "host-client",
        name: "Host",
        host: true,
        spectator: false,
        bot: false,
        active: false,
        muted: false,
        status: "host-disconnected"
      },
      {
        id: "bot-alpha",
        name: "Bot Alpha",
        host: false,
        spectator: false,
        bot: true,
        role: "bot",
        active: true,
        muted: false,
        status: "bot"
      },
      {
        id: "bot-beta",
        name: "Bot Beta",
        host: false,
        spectator: false,
        bot: true,
        role: "bot",
        active: true,
        muted: false,
        status: "bot"
      }
    ],
    game: {
      matchId,
      status: "playing",
      round: 1,
      setup: {
        ...makeSetup(1),
        botAnswerPool: ["Bot answer", "Wrong"],
        botWrongPool: ["Wrong"]
      },
      answers: {},
      participantTimers: {
        "bot-alpha": { endsAt: Date.now() + 20000, speedMultiplier: 1, status: "running" },
        "bot-beta": { endsAt: Date.now() + 20000, speedMultiplier: 1, status: "running" }
      },
      gradingForceAt: Date.now() + 22000,
      updatedAt: Date.now()
    }
  }));

  const grading = await roomGradingCommand(code, {
    participantId: "host-client",
    hostParticipantId: "host-client",
    matchId,
    round: 1,
    reason: "host-skip"
  });
  assert.equal(grading.response.status, 200, grading.payload.error);
  assert.equal(grading.payload.eventType, "round-grading");
  assert.equal(grading.payload.grading.submissions.length, 2);
  assert.deepEqual(new Set(grading.payload.grading.submissions.map((entry) => entry.participantId)), new Set(["bot-alpha", "bot-beta"]));
  assert.equal(grading.payload.events.filter((event) => event.type === "answer_submitted").length, 2);

  const stored = await getRoom(code);
  assert.equal(stored.response.status, 200, stored.payload.error);
  assert.equal(stored.payload.room.game.status, "grading");
  assert.equal(stored.payload.room.game.answers["bot-alpha"].autoSubmitted, true);
  assert.equal(stored.payload.room.game.answers["bot-beta"].autoSubmitted, true);
  assert.equal(stored.payload.room.events.filter((event) => event.type === "round_grading").length, 1);
}

async function testPresenceSubmissionCanStartGradingWhenAllSubmitted() {
  const code = makeCode(8177);
  const matchId = `${code}-match`;
  await upsertRoom(makeRoom(code, {
    status: "in-progress",
    participants: [
      {
        id: "host-client",
        name: "Host",
        host: true,
        spectator: false,
        bot: false,
        active: true,
        muted: false,
        status: "submitted",
        answer: "Host answer",
        submittedRound: 1,
        submissionMatchId: matchId,
        remainingTime: 10
      },
      {
        id: "guest-client",
        name: "Guest",
        host: false,
        spectator: false,
        bot: false,
        active: true,
        muted: false,
        status: "playing",
        profileUserId: "guest:presence-submitter"
      }
    ],
    game: {
      matchId,
      status: "playing",
      round: 1,
      setup: makeSetup(1),
      answers: {
        "host-client": {
          participantId: "host-client",
          matchId,
          round: 1,
          status: "submitted",
          answer: "Host answer",
          remainingTime: 10,
          submittedAt: Date.now() - 1000
        }
      },
      updatedAt: Date.now()
    }
  }));

  const presence = await enrichRoomCommandResult(code, await roomCommand(code, "rejoin_room", {
    participantId: "guest-client",
    matchId,
    round: 1,
    participant: {
      id: "guest-client",
      name: "Guest",
      profileUserId: "guest:presence-submitter",
      status: "submitted",
      answer: "Guest answer",
      submittedRound: 1,
      submissionMatchId: matchId,
      remainingTime: 8
    }
  }), { preferredEventType: "answer_submitted" });
  assert.equal(presence.response.status, 200, presence.payload.error);
  assert.equal(presence.payload.events.some((event) => event.type === "answer_submitted" && event.payload.participantId === "guest-client"), true);
  assert.equal(presence.payload.events.some((event) => event.type === "round_grading"), true);

  const stored = await getRoom(code);
  assert.equal(stored.response.status, 200, stored.payload.error);
  assert.equal(stored.payload.room.game.status, "grading");
  assert.equal(stored.payload.room.game.answers["guest-client"].answer, "Guest answer");
}

async function testResolveAllSubmittedCommandStartsGradingFromAuthoritativeAnswers() {
  const code = makeCode(8178);
  const matchId = `${code}-match`;
  await upsertRoom(makeRoom(code, {
    status: "in-progress",
    participants: [
      {
        id: "host-client",
        name: "Host",
        host: true,
        spectator: false,
        bot: false,
        active: true,
        muted: false,
        status: "submitted",
        answer: "Host answer",
        submittedRound: 1,
        submissionMatchId: matchId,
        remainingTime: 11
      },
      {
        id: "guest-client",
        name: "Guest",
        host: false,
        spectator: false,
        bot: false,
        active: true,
        muted: false,
        status: "submitted",
        answer: "Guest answer",
        submittedRound: 1,
        submissionMatchId: matchId,
        remainingTime: 9
      }
    ],
    game: {
      matchId,
      status: "playing",
      round: 1,
      setup: makeSetup(1),
      answers: {
        "host-client": {
          participantId: "host-client",
          matchId,
          round: 1,
          status: "submitted",
          answer: "Host answer",
          remainingTime: 11,
          submittedAt: Date.now() - 2000
        },
        "guest-client": {
          participantId: "guest-client",
          matchId,
          round: 1,
          status: "submitted",
          answer: "Guest answer",
          remainingTime: 9,
          submittedAt: Date.now() - 1500
        }
      },
      updatedAt: Date.now()
    }
  }));

  const resolved = await roomResolveAllSubmittedCommand(code, {
    participantId: "guest-client",
    matchId,
    round: 1
  });
  assert.equal(resolved.response.status, 200, resolved.payload.error);
  assert.equal(resolved.payload.events.some((event) => event.type === "round_grading"), true);

  const stored = await getRoom(code);
  assert.equal(stored.response.status, 200, stored.payload.error);
  assert.equal(stored.payload.room.game.status, "grading");
  assert.equal(stored.payload.room.events.filter((event) => event.type === "round_grading").length, 1);
}

async function testDisconnectedParticipantStatusDoesNotBlockGrading() {
  const code = makeCode(8165);
  const matchId = `${code}-match`;
  await upsertRoom(makeRoom(code, {
    status: "in-progress",
    participants: [
      {
        id: "host-client",
        name: "Host",
        host: true,
        spectator: false,
        bot: false,
        active: true,
        muted: false,
        status: "playing"
      },
      {
        id: "guest-client",
        name: "Guest",
        host: false,
        spectator: false,
        bot: false,
        active: true,
        muted: false,
        status: "playing"
      },
      {
        id: "stale-client",
        name: "Stale",
        host: false,
        spectator: false,
        bot: false,
        active: true,
        muted: false,
        status: "disconnected"
      }
    ],
    game: {
      matchId,
      status: "playing",
      round: 2,
      setup: makeSetup(2),
      answers: {},
      updatedAt: Date.now()
    }
  }));

  const first = await roomAnswerCommand(code, {
    participantId: "host-client",
    matchId,
    round: 2,
    answer: "Host answer",
    remainingTime: 12
  });
  assert.equal(first.response.status, 200, first.payload.error);
  assert.equal(first.payload.grading, undefined);

  const second = await roomAnswerCommand(code, {
    participantId: "guest-client",
    hostParticipantId: "host-client",
    matchId,
    round: 2,
    answer: "Guest answer",
    remainingTime: 9
  });
  assert.equal(second.response.status, 200, second.payload.error);
  assert.equal(second.payload.grading.eventType, "round-grading");
  assert.equal(second.payload.grading.submissions.length, 2);
  assert.equal(second.payload.grading.submissions.some((entry) => entry.participantId === "stale-client"), false);
}

async function testSimultaneousRoomSubmissionsStartSingleGradingTransition() {
  const code = makeCode(8190);
  const matchId = `${code}-match`;
  await upsertRoom(makeRoom(code, {
    status: "in-progress",
    participants: [
      {
        id: "host-client",
        name: "Host",
        host: true,
        spectator: false,
        bot: false,
        active: true,
        muted: false,
        status: "host"
      },
      {
        id: "guest-client",
        name: "Guest",
        host: false,
        spectator: false,
        bot: false,
        active: true,
        muted: false,
        status: "joined"
      }
    ],
    game: {
      matchId,
      status: "playing",
      round: 1,
      setup: makeSetup(1),
      answers: {},
      updatedAt: Date.now()
    }
  }));

  const submissions = await Promise.all([
    roomAnswerCommand(code, {
      participantId: "host-client",
      matchId,
      round: 1,
      answer: "Host answer",
      remainingTime: 10
    }),
    roomAnswerCommand(code, {
      participantId: "guest-client",
      hostParticipantId: "host-client",
      matchId,
      round: 1,
      answer: "Guest answer",
      remainingTime: 9
    })
  ]);
  submissions.forEach(({ response, payload }) => {
    assert.equal(response.status, 200, payload.error);
  });
  assert.equal(submissions.filter((result) => result.payload.grading).length, 1);

  const stored = await getRoom(code);
  assert.equal(stored.response.status, 200, stored.payload.error);
  assert.equal(stored.payload.room.game.status, "grading");
  assert.equal(stored.payload.room.game.answers["host-client"].answer, "Host answer");
  assert.equal(stored.payload.room.game.answers["guest-client"].answer, "Guest answer");
  assert.equal(stored.payload.room.events.filter((event) => event.type === "round_grading").length, 1);
}

async function testDuplicateRoomAnswerCanCompleteStuckAllSubmittedRound() {
  const code = makeCode(8167);
  const matchId = `${code}-match`;
  await upsertRoom(makeRoom(code, {
    status: "in-progress",
    participants: [
      {
        id: "host-client",
        name: "Host",
        host: true,
        spectator: false,
        bot: false,
        active: true,
        muted: false,
        status: "submitted",
        answer: "Host answer",
        submittedRound: 2,
        submissionMatchId: matchId,
        remainingTime: 12
      },
      {
        id: "guest-client",
        name: "Guest",
        host: false,
        spectator: false,
        bot: false,
        active: true,
        muted: false,
        status: "submitted",
        answer: "Guest answer",
        submittedRound: 2,
        submissionMatchId: matchId,
        remainingTime: 9
      }
    ],
    game: {
      matchId,
      status: "playing",
      round: 2,
      setup: makeSetup(2),
      answers: {
        "host-client": {
          participantId: "host-client",
          matchId,
          round: 2,
          status: "submitted",
          answer: "Host answer",
          remainingTime: 12,
          submittedAt: Date.now() - 2000
        },
        "guest-client": {
          participantId: "guest-client",
          matchId,
          round: 2,
          status: "submitted",
          answer: "Guest answer",
          remainingTime: 9,
          submittedAt: Date.now() - 1000
        }
      },
      updatedAt: Date.now()
    }
  }));

  const duplicate = await roomAnswerCommand(code, {
    participantId: "guest-client",
    hostParticipantId: "host-client",
    matchId,
    round: 2,
    answer: "Different duplicate answer",
    remainingTime: 1
  });
  assert.equal(duplicate.response.status, 200, duplicate.payload.error);
  assert.equal(duplicate.payload.duplicate, true);
  assert.equal(duplicate.payload.answer, "Guest answer");
  assert.equal(duplicate.payload.grading.eventType, "round-grading");
  assert.equal(duplicate.payload.grading.reason, "all-submitted");
  assert.equal(duplicate.payload.grading.submissions.length, 2);

  const stored = await getRoom(code);
  assert.equal(stored.response.status, 200, stored.payload.error);
  assert.equal(stored.payload.room.game.status, "grading");
  assert.equal(stored.payload.room.events.some((event) => event.type === "round_grading"), true);
}

async function testRoomRoundAdvancingEndpointStampsEvent() {
  const code = makeCode(8140);
  const matchId = `${code}-match`;
  await upsertRoom(makeRoom(code, {
    participants: [
      {
        id: "host-client",
        name: "Host",
        host: true,
        spectator: false,
        bot: false,
        active: true,
        muted: false,
        status: "host"
      },
      {
        id: "guest-client",
        name: "Guest",
        host: false,
        spectator: false,
        bot: false,
        active: true,
        muted: false,
        status: "joined"
      }
    ]
  }));

  const { response, payload } = await roomRoundAdvancingCommand(code, {
    hostParticipantId: "host-client",
    matchId,
    round: 1,
    matchSettings: {
      rounds: 7,
      timerSeconds: 45,
      maxPlayers: 6,
      chaos: true,
      autoAdvance: false,
      enabledThemes: ["Science"]
    }
  });
  assert.equal(response.status, 200, payload.error);
  assert.equal(payload.eventType, "round-started");
  assert.equal(payload.matchId, matchId);
  assert.equal(payload.round, 1);
  assert.equal(payload.game.status, "playing");
  assert.ok(payload.game.setup);
  assert.ok(payload.game.setupStartedAt > 0);
  assert.ok(payload.game.roundStartedAt > 0);
  assert.equal(payload.game.matchSettings.chaos, true);
  assert.equal(payload.game.matchSettings.autoAdvance, false);
  assert.ok(payload.revision >= 2);
  assert.deepEqual(
    payload.events.map((event) => event.type),
    ["room_created", "round_advancing", "round_started"].slice(1)
  );

  const stored = await getRoom(code);
  assert.equal(stored.response.status, 200, stored.payload.error);
  assert.equal(stored.payload.room.status, "in-progress");
  assert.equal(stored.payload.room.game.matchId, matchId);
  assert.equal(stored.payload.room.game.round, 1);
  assert.equal(stored.payload.room.game.status, "playing");
  assert.ok(stored.payload.room.game.setup);
  assert.ok(stored.payload.room.game.setupStartedAt > 0);
  assert.ok(stored.payload.room.game.roundStartedAt > 0);
  assert.equal(stored.payload.room.settings.chaos, true);
  assert.equal(stored.payload.room.settings.randomModifiers, false);
  assert.equal(stored.payload.room.events.some((event) => event.type === "round_advancing"), true);
}

async function testRoomCommandClientEventIdIsIdempotent() {
  const code = makeCode(8194);
  const clientEventId = `${code}:settings:fixed-retry`;
  await upsertRoom(makeRoom(code));

  const first = await roomCommand(code, "update_settings", {
    hostParticipantId: "host-client",
    status: "lobby",
    settings: {
      ...makeRoom(code).settings,
      timerSeconds: 45
    }
  }, {}, { clientEventId });
  assert.equal(first.response.status, 200, first.payload.error);
  assert.equal(first.payload.duplicate, undefined);
  const firstRevision = first.payload.revision;
  assert.ok(first.payload.events.some((event) => event.type === "settings_updated"));

  const retry = await roomCommand(code, "update_settings", {
    hostParticipantId: "host-client",
    status: "lobby",
    settings: {
      ...makeRoom(code).settings,
      timerSeconds: 10
    }
  }, {}, { clientEventId });
  assert.equal(retry.response.status, 200, retry.payload.error);
  assert.equal(retry.payload.duplicate, true);
  assert.equal(retry.payload.revision, firstRevision);
  assert.equal(retry.payload.events.length, first.payload.events.length);

  const stored = await getRoom(code);
  assert.equal(stored.response.status, 200, stored.payload.error);
  assert.equal(stored.payload.room.revision, firstRevision);
  assert.equal(stored.payload.room.settings.timerSeconds, 45);
  assert.equal(
    stored.payload.room.events.filter((event) => event.clientEventId === clientEventId).length,
    first.payload.events.length
  );
}

async function testDuplicateRoomCommandRepublishesPersistedEvents() {
  const code = makeCode(8195);
  const clientEventId = `${code}:settings:lost-delivery`;
  await upsertRoom(makeRoom(code));

  const previousFetch = global.fetch;
  const previousBroadcastMode = process.env.SERVER_REALTIME_BROADCAST;
  const broadcasts = [];
  process.env.SERVER_REALTIME_BROADCAST = "true";
  global.fetch = async (url, options = {}) => {
    broadcasts.push({
      url: String(url),
      body: JSON.parse(String(options.body || "{}"))
    });
    return { ok: true, status: 200 };
  };

  try {
    const first = await roomCommand(code, "update_settings", {
      hostParticipantId: "host-client",
      status: "lobby",
      settings: {
        ...makeRoom(code).settings,
        timerSeconds: 45
      }
    }, {}, { clientEventId });
    assert.equal(first.response.status, 200, first.payload.error);
    const firstRevision = first.payload.revision;
    assert.ok(first.payload.events.some((event) => event.type === "settings_updated"));

    // Simulate the client retrying after the original response or realtime
    // delivery was lost. The stored command must be replayed to subscribers.
    broadcasts.length = 0;
    const retry = await roomCommand(code, "update_settings", {
      hostParticipantId: "host-client",
      status: "lobby",
      settings: {
        ...makeRoom(code).settings,
        timerSeconds: 10
      }
    }, {}, { clientEventId });
    assert.equal(retry.response.status, 200, retry.payload.error);
    assert.equal(retry.payload.duplicate, true);
    assert.equal(retry.payload.revision, firstRevision);
    assert.equal(broadcasts.length, 1);

    const roomMessages = broadcasts[0].body.messages.filter((message) => (
      message.topic === `trivia-against-ai:room:${code}`
    ));
    assert.equal(roomMessages.length, 1);
    assert.equal(roomMessages[0].payload.sourceId, "server");
    assert.equal(roomMessages[0].payload.payload.clientEventId, clientEventId);
    assert.equal(roomMessages[0].payload.payload.revision, firstRevision);
  } finally {
    global.fetch = previousFetch;
    if (previousBroadcastMode === undefined) {
      delete process.env.SERVER_REALTIME_BROADCAST;
    } else {
      process.env.SERVER_REALTIME_BROADCAST = previousBroadcastMode;
    }
  }
}

async function testRoomUsesStoredHostQuestionLanguage() {
  const code = makeCode(8143);
  const room = makeRoom(code, {
    participants: [
      {
        id: "host-client",
        name: "Host",
        host: true,
        spectator: false,
        bot: false,
        active: true,
        muted: false,
        status: "host"
      },
      {
        id: "guest-client",
        name: "Guest",
        host: false,
        spectator: false,
        bot: false,
        active: true,
        muted: false,
        status: "joined"
      }
    ]
  });
  room.settings.questionLanguage = "zh-Hans";
  await upsertRoom(room);

  const started = await roomRoundAdvancingCommand(code, {
    hostParticipantId: "host-client",
    matchId: `${code}-match`,
    round: 1,
    matchSettings: {
      rounds: 5,
      timerSeconds: 30,
      maxPlayers: 5,
      enabledThemes: ["Science"]
    }
  });
  assert.equal(started.response.status, 200, started.payload.error);
  assert.equal(started.payload.game.matchSettings.questionLanguage, "zh-Hans");
  assert.equal(started.payload.game.setup.language, "zh-Hans");
  assert.equal(started.payload.room.settings.questionLanguage, "zh-Hans");

  const stored = await getRoom(code);
  assert.equal(stored.response.status, 200, stored.payload.error);
  assert.equal(stored.payload.room.settings.questionLanguage, "zh-Hans");
  assert.equal(stored.payload.room.game.matchSettings.questionLanguage, "zh-Hans");
  assert.equal(stored.payload.room.game.setup.language, "zh-Hans");
}

async function testRoomStartMatchPreservesInitialPowerState() {
  const code = makeCode(8142);
  const matchId = `${code}-match`;
  await upsertRoom(makeRoom(code, {
    participants: [
      {
        id: "host-client",
        name: "Host",
        host: true,
        spectator: false,
        bot: false,
        active: true,
        muted: false,
        status: "host"
      },
      {
        id: "guest-client",
        name: "Guest",
        host: false,
        spectator: false,
        bot: false,
        active: true,
        muted: false,
        status: "joined"
      }
    ]
  }));

  const initialPowerState = {
    matchId,
    updatedAt: Date.now(),
    hands: [
      { participantId: "host-client", owner: "player", hand: ["shuffle", "shield", "time_bender"], fresh: ["shuffle", "shield", "time_bender"] },
      { participantId: "guest-client", owner: "opponent", hand: ["xray_hacks", "dead_weight", "bounty"], fresh: ["xray_hacks", "dead_weight", "bounty"] }
    ],
    played: [
      { participantId: "host-client", owner: "player", stacks: [], primaryPowerId: "", meta: null },
      { participantId: "guest-client", owner: "opponent", stacks: [], primaryPowerId: "", meta: null }
    ],
    players: [
      { participantId: "host-client", owner: "player", score: 0, streak: 0 },
      { participantId: "guest-client", owner: "opponent", score: 0, streak: 0 }
    ],
    effects: {}
  };
  const started = await roomRoundAdvancingCommand(code, {
    hostParticipantId: "host-client",
    matchId,
    round: 1,
    matchSettings: { ...makeRoom(code).settings, rounds: 5 },
    powerState: initialPowerState
  });
  assert.equal(started.response.status, 200, started.payload.error);
  assert.equal(started.payload.eventType, "round-started");
  assert.deepEqual(started.payload.game.powerState.hands.find((entry) => entry.participantId === "host-client").hand, ["shuffle", "shield", "time_bender"]);
  assert.deepEqual(started.payload.game.powerState.hands.find((entry) => entry.participantId === "guest-client").hand, ["xray_hacks", "dead_weight", "bounty"]);
}

async function testRematchDoesNotReusePreviousPowerState() {
  const code = makeCode(8141);
  const oldMatchId = `${code}-old-match`;
  const newMatchId = `${code}-new-match`;
  await upsertRoom(makeRoom(code, {
    status: "complete",
    participants: [
      {
        id: "host-client",
        name: "Host",
        host: true,
        spectator: false,
        bot: false,
        active: true,
        muted: false,
        status: "host"
      },
      {
        id: "guest-client",
        name: "Guest",
        host: false,
        spectator: false,
        bot: false,
        active: true,
        muted: false,
        status: "joined"
      }
    ],
    game: {
      matchId: oldMatchId,
      status: "ended",
      round: 5,
      setup: makeSetup(5),
      powerState: {
        matchId: oldMatchId,
        hands: [{ participantId: "host-client", owner: "player", hand: ["typhoon_season"] }],
        played: [],
        players: [],
        effects: { maps: { typhoonOwners: { player: { stacks: 1 } } } }
      },
      updatedAt: Date.now()
    }
  }));

  const started = await roomCommand(code, "rematch", {
    hostParticipantId: "host-client",
    matchId: newMatchId,
    round: 1,
    matchSettings: {
      ...makeRoom(code).settings,
      rounds: 5
    },
    powerState: {
      matchId: oldMatchId,
      hands: [{ participantId: "host-client", owner: "player", hand: ["typhoon_season"] }],
      played: [],
      players: [],
      effects: { maps: { typhoonOwners: { player: { stacks: 1 } } } }
    }
  });
  assert.equal(started.response.status, 200, started.payload.error);
  assert.equal(started.payload.game.matchId, newMatchId);
  assert.equal(started.payload.game.powerState, null);

  const stored = await getRoom(code);
  assert.equal(stored.response.status, 200, stored.payload.error);
  assert.equal(stored.payload.room.game.matchId, newMatchId);
  assert.equal(stored.payload.room.game.powerState, null);
}

async function testRoomRoundSetupEndpointCreatesSharedSetup() {
  const code = makeCode(8160);
  const matchId = `${code}-match`;
  const setupStartedAt = Date.now() - 1500;
  await upsertRoom(makeRoom(code, {
    status: "in-progress",
    participants: [
      {
        id: "host-client",
        name: "Host",
        host: true,
        spectator: false,
        bot: false,
        active: true,
        muted: false,
        status: "host",
        answer: "",
        submittedRound: 0,
        remainingTime: 0
      },
      {
        id: "guest-client",
        name: "Guest",
        host: false,
        spectator: false,
        bot: false,
        active: true,
        muted: false,
        status: "joined",
        answer: "",
        submittedRound: 0,
        remainingTime: 0
      },
      {
        id: "spectator-client",
        name: "Spectator",
        host: false,
        spectator: true,
        bot: false,
        active: true,
        muted: false,
        status: "spectating",
        answer: "",
        submittedRound: 0,
        remainingTime: 0
      }
    ],
    game: {
      matchId,
      status: "starting",
      round: 1,
      setup: null,
      matchSettings: {
        rounds: 5,
        timerSeconds: 30,
        maxPlayers: 4,
        enabledThemes: ["Science"]
      },
      setupStartedAt,
      roundStartedAt: 0,
      updatedAt: Date.now()
    }
  }));

  const { response, payload } = await roomRoundSetupCommand(code, {
    hostParticipantId: "host-client",
    matchId,
    round: 1,
    totalRounds: 5,
    enabledThemes: ["Science"],
    setupSeed: `${code}-seed`
  });
  assert.equal(response.status, 200, payload.error);
  assert.equal(payload.eventType, "round-started");
  assert.equal(payload.matchId, matchId);
  assert.equal(payload.round, 1);
  assert.equal(payload.game.status, "playing");
  assert.ok(payload.game.setup.blackCard);
  assert.equal(payload.game.setupStartedAt, setupStartedAt);
  assert.ok(payload.game.roundStartedAt >= setupStartedAt);
  assert.equal(payload.game.baseDurationMs, 30000);
  assert.ok(payload.game.participantTimers["host-client"].endsAt >= payload.game.roundStartedAt + 30000);
  assert.ok(payload.game.participantTimers["guest-client"].endsAt >= payload.game.roundStartedAt + 30000);
  assert.equal(payload.game.participantTimers["host-client"].speedMultiplier, 1);
  assert.equal(payload.game.participantTimers["guest-client"].status, "running");
  assert.equal(payload.game.participantTimers["spectator-client"], undefined);
  assert.ok(payload.game.gradingForceAt >= payload.game.participantTimers["host-client"].endsAt);
  assert.equal(payload.room.game.setup.blackCard, payload.game.setup.blackCard);

  const stored = await getRoom(code);
  assert.equal(stored.response.status, 200, stored.payload.error);
  assert.equal(stored.payload.room.game.status, "playing");
  assert.equal(stored.payload.room.game.setup.blackCard, payload.game.setup.blackCard);
  assert.deepEqual(stored.payload.room.game.participantTimers, payload.game.participantTimers);
  assert.equal(stored.payload.room.events.some((event) => event.type === "round_started"), true);
}

async function testRoomRoundSetupRecoversMissingPreparationState() {
  const code = makeCode(8166);
  const matchId = `${code}-match`;
  await upsertRoom(makeRoom(code, {
    status: "lobby",
    participants: [
      {
        id: "host-client",
        name: "Host",
        host: true,
        spectator: false,
        bot: false,
        active: true,
        muted: false,
        status: "host",
        answer: "",
        submittedRound: 0,
        remainingTime: 0
      },
      {
        id: "guest-client",
        name: "Guest",
        host: false,
        spectator: false,
        bot: false,
        active: true,
        muted: false,
        status: "joined",
        answer: "",
        submittedRound: 0,
        remainingTime: 0
      }
    ],
    game: null
  }));

  const { response, payload } = await roomRoundSetupCommand(code, {
    hostParticipantId: "host-client",
    matchId,
    round: 1,
    totalRounds: 5,
    enabledThemes: ["Science"],
    matchSettings: {
      rounds: 5,
      timerSeconds: 30,
      maxPlayers: 4,
      autoAdvance: true,
      enabledThemes: ["Science"]
    },
    setupSeed: `${code}-missing-prepare`
  });
  assert.equal(response.status, 200, payload.error);
  assert.equal(payload.eventType, "round-started");
  assert.equal(payload.matchId, matchId);
  assert.equal(payload.round, 1);
  assert.equal(payload.game.status, "playing");
  assert.ok(payload.game.setup.blackCard);
  assert.equal(payload.room.status, "in-progress");
  assert.equal(payload.room.game.status, "playing");
  assert.ok(payload.room.game.participantTimers["host-client"]);
  assert.ok(payload.room.game.participantTimers["guest-client"]);

  const stored = await getRoom(code);
  assert.equal(stored.response.status, 200, stored.payload.error);
  assert.equal(stored.payload.room.status, "in-progress");
  assert.equal(stored.payload.room.game.matchId, matchId);
  assert.equal(stored.payload.room.game.status, "playing");
  assert.equal(stored.payload.room.events.some((event) => event.type === "round_advancing"), true);
  assert.equal(stored.payload.room.events.some((event) => event.type === "round_started"), true);
}

async function testRoomRoundSetupCannotSkipPreparedRound() {
  const code = makeCode(8161);
  const matchId = `${code}-match`;
  await upsertRoom(makeRoom(code, {
    status: "in-progress",
    game: {
      matchId,
      status: "starting",
      round: 1,
      setup: null,
      updatedAt: Date.now()
    }
  }));

  const skipped = await roomRoundSetupCommand(code, {
    hostParticipantId: "host-client",
    matchId,
    round: 2,
    totalRounds: 5
  });
  assert.equal(skipped.response.status, 409);

  const stored = await getRoom(code);
  assert.equal(stored.response.status, 200, stored.payload.error);
  assert.equal(stored.payload.room.game.status, "starting");
  assert.equal(stored.payload.room.game.setup, null);
}

async function testStaleRoomRoundAdvancingCannotOverwriteCurrentRound() {
  const code = makeCode(8141);
  const matchId = `${code}-match`;
  await upsertRoom(makeRoom(code, {
    status: "in-progress",
    game: {
      matchId,
      status: "playing",
      round: 2,
      setup: makeSetup(2),
      updatedAt: Date.now()
    }
  }));

  const stale = await roomRoundAdvancingCommand(code, {
    hostParticipantId: "host-client",
    matchId,
    round: 1
  });
  assert.equal(stale.response.status, 409);

  const stored = await getRoom(code);
  assert.equal(stored.response.status, 200, stored.payload.error);
  assert.equal(stored.payload.room.game.round, 2);
  assert.equal(stored.payload.room.game.status, "playing");
  assert.equal(stored.payload.room.game.setup.blackCard, "Round 2 question?");
}

async function testDelayedRoomRoundAdvancingCannotClearStartedSetup() {
  const code = makeCode(8142);
  const matchId = `${code}-match`;
  await upsertRoom(makeRoom(code, {
    status: "in-progress",
    participants: [
      {
        id: "host-client",
        name: "Host",
        host: true,
        active: true,
        status: "host"
      },
      {
        id: "guest-client",
        name: "Guest",
        active: true,
        status: "joined"
      }
    ],
    game: {
      matchId,
      status: "playing",
      round: 1,
      setup: makeSetup(1),
      updatedAt: Date.now()
    }
  }));

  const delayed = await roomRoundAdvancingCommand(code, {
    hostParticipantId: "host-client",
    matchId,
    round: 1
  });
  assert.equal(delayed.response.status, 200, delayed.payload.error);
  assert.equal(delayed.payload.duplicate, true);

  const stored = await getRoom(code);
  assert.equal(stored.response.status, 200, stored.payload.error);
  assert.equal(stored.payload.room.game.status, "playing");
  assert.equal(stored.payload.room.game.setup.blackCard, "Round 1 question?");
}

async function testStaleRoomSetupCannotOverwriteGrading() {
  const code = makeCode(8143);
  const matchId = `${code}-match`;
  await upsertRoom(makeRoom(code, {
    status: "in-progress",
    game: {
      matchId,
      status: "grading",
      round: 2,
      setup: makeSetup(2),
      roundResult: makeRoundResult(2, { matchId }),
      updatedAt: Date.now()
    }
  }));

  const stale = await roomGameCommand(code, {
    hostParticipantId: "host-client",
    game: {
      matchId,
      status: "playing",
      round: 2,
      setup: makeSetup(2),
      updatedAt: Date.now()
    }
  });
  assert.equal(stale.response.status, 409);

  const stored = await getRoom(code);
  assert.equal(stored.response.status, 200, stored.payload.error);
  assert.equal(stored.payload.room.game.status, "grading");
  assert.equal(stored.payload.room.game.roundResult.questionId, "test-question-2");
}

async function testRematchRoundSetupCanStartAfterCompleteMatch() {
  const code = makeCode(8144);
  await upsertRoom(makeRoom(code, {
    status: "complete",
    participants: [
      {
        id: "host-client",
        name: "Host",
        host: true,
        active: true,
        status: "host"
      },
      {
        id: "guest-client",
        name: "Guest",
        active: true,
        status: "joined"
      }
    ],
    game: {
      matchId: `${code}-old-match`,
      status: "ended",
      round: 10,
      setup: makeSetup(10),
      updatedAt: Date.now()
    }
  }));

  const started = await roomGameCommand(code, {
    hostParticipantId: "host-client",
    game: {
      matchId: `${code}-new-match`,
      status: "playing",
      round: 1,
      setup: makeSetup(1),
      updatedAt: Date.now()
    }
  });
  assert.equal(started.response.status, 200, started.payload.error);
  assert.equal(started.payload.room.status, "in-progress");
  assert.equal(started.payload.room.game.matchId, `${code}-new-match`);
  assert.equal(started.payload.room.game.round, 1);
  assert.equal(started.payload.room.game.status, "playing");
  assert.ok(started.payload.room.game.setup.blackCard);

  const prepared = await roomRoundSetupCommand(code, {
    hostParticipantId: "host-client",
    matchId: `${code}-new-match`,
    round: 1,
    enabledThemes: ["Science"],
    totalRounds: 10,
    setupSeed: "rematch-command-test"
  });
  assert.equal(prepared.response.status, 200, prepared.payload.error);
  assert.equal(prepared.payload.room.game.matchId, `${code}-new-match`);
  assert.equal(prepared.payload.room.game.round, 1);
  assert.equal(prepared.payload.room.game.status, "playing");
  assert.ok(prepared.payload.room.game.setup.blackCard);
}

async function testStaleRoomRoundResultCannotOverwriteCurrentRound() {
  const code = makeCode(8133);
  const matchId = `${code}-match`;
  await upsertRoom(makeRoom(code, {
    status: "in-progress",
    game: {
      matchId,
      status: "playing",
      round: 2,
      setup: makeSetup(2),
      roundResult: null,
      updatedAt: Date.now()
    }
  }));

  const stale = await roomRoundResultCommand(code, {
    hostParticipantId: "host-client",
    roundResult: makeRoundResult(1, { matchId, questionId: "previous-round-question" })
  });
  assert.equal(stale.response.status, 409);

  const stored = await getRoom(code);
  assert.equal(stored.response.status, 200, stored.payload.error);
  assert.equal(stored.payload.room.game.round, 2);
  assert.equal(stored.payload.room.game.roundResult, null);
}

async function testStaleRoomRoundSkipCannotOverwriteCurrentRound() {
  const code = makeCode(8134);
  const matchId = `${code}-match`;
  await upsertRoom(makeRoom(code, {
    status: "in-progress",
    participants: [
      {
        id: "host-client",
        name: "Host",
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
      },
      {
        id: "guest-client",
        name: "Guest",
        host: false,
        spectator: false,
        bot: false,
        active: true,
        muted: false,
        status: "joined",
        answer: "",
        submittedRound: 0,
        submissionMatchId: "",
        remainingTime: 0
      }
    ],
    game: {
      matchId,
      status: "playing",
      round: 2,
      setup: makeSetup(2),
      updatedAt: Date.now()
    }
  }));

  const stale = await roomRoundSkipCommand(code, {
    hostParticipantId: "host-client",
    matchId,
    round: 1,
    submissions: [
      { participantId: "host-client", owner: "player", answer: "Old host answer", remainingTime: 0 },
      { participantId: "guest-client", owner: "opponent", answer: "Old guest answer", remainingTime: 0 }
    ]
  });
  assert.equal(stale.response.status, 409);

  const stored = await getRoom(code);
  assert.equal(stored.response.status, 200, stored.payload.error);
  const host = stored.payload.room.participants.find((participant) => participant.id === "host-client");
  const guest = stored.payload.room.participants.find((participant) => participant.id === "guest-client");
  assert.equal(host.answer, "");
  assert.equal(host.submittedRound, 0);
  assert.equal(guest.answer, "");
  assert.equal(guest.submittedRound, 0);
}

async function testStaleRoomPowerStateCannotOverwriteCurrentRound() {
  const code = makeCode(8135);
  const matchId = `${code}-match`;
  await upsertRoom(makeRoom(code, {
    status: "in-progress",
    participants: [
      {
        id: "host-client",
        name: "Host",
        host: true,
        spectator: false,
        bot: false,
        active: true,
        muted: false,
        status: "host"
      }
    ],
    game: {
      matchId,
      status: "playing",
      round: 2,
      setup: makeSetup(2),
      powerState: {
        matchId,
        updatedAt: 2000,
        hands: [
          { participantId: "host-client", owner: "player", updatedAt: 2000, hand: ["shuffle"], fresh: ["shuffle"] }
        ],
        played: [],
        players: [],
        effects: { maps: {}, arrays: {}, values: {} }
      },
      updatedAt: Date.now()
    }
  }));

  const stale = await roomPowerStateCommand(code, {
    matchId,
    round: 1,
    powerId: "old-round-power",
    actorParticipantId: "host-client",
    hands: [
      { participantId: "host-client", owner: "player", updatedAt: 3000, hand: ["dead_weight"], fresh: ["dead_weight"] }
    ]
  });
  assert.equal(stale.response.status, 409);

  const stored = await getRoom(code);
  assert.equal(stored.response.status, 200, stored.payload.error);
  const hand = stored.payload.room.game.powerState.hands.find((entry) => entry.participantId === "host-client");
  assert.equal(stored.payload.room.game.round, 2);
  assert.deepEqual(hand.hand, ["shuffle"]);
}

async function testFutureRoomPowerStateCannotOverwriteCurrentRound() {
  const code = makeCode(8136);
  const matchId = `${code}-match`;
  await upsertRoom(makeRoom(code, {
    status: "in-progress",
    participants: [
      {
        id: "host-client",
        name: "Host",
        host: true,
        spectator: false,
        bot: false,
        active: true,
        muted: false,
        status: "host"
      }
    ],
    game: {
      matchId,
      status: "playing",
      round: 1,
      setup: makeSetup(1),
      powerState: {
        matchId,
        updatedAt: 2000,
        hands: [
          { participantId: "host-client", owner: "player", updatedAt: 2000, hand: ["shuffle"], fresh: ["shuffle"] }
        ],
        played: [
          {
            participantId: "host-client",
            owner: "player",
            updatedAt: 2000,
            stacks: [{ powerId: "shuffle", revealId: "round-1-shuffle", meta: {} }],
            primaryPowerId: "shuffle",
            meta: {}
          }
        ],
        players: [],
        effects: { maps: {}, arrays: {}, values: {} }
      },
      updatedAt: Date.now()
    }
  }));

  const futureReset = await roomPowerStateCommand(code, {
    matchId,
    round: 2,
    powerId: "round-reset",
    played: [
      { participantId: "host-client", owner: "player", updatedAt: 3000, stacks: [], primaryPowerId: "", meta: null }
    ]
  });
  assert.equal(futureReset.response.status, 409);

  const stored = await getRoom(code);
  assert.equal(stored.response.status, 200, stored.payload.error);
  const played = stored.payload.room.game.powerState.played.find((entry) => entry.participantId === "host-client");
  assert.equal(stored.payload.room.game.round, 1);
  assert.equal(played.primaryPowerId, "shuffle");
  assert.deepEqual(played.stacks.map((entry) => entry.powerId), ["shuffle"]);
}

async function testRoomPowerStateDeltaPreservesStoredFullState() {
  const code = makeCode(8115);
  await upsertRoom(makeRoom(code, {
    status: "in-progress",
    participants: [
      {
        id: "host-client",
        name: "Host",
        host: true,
        spectator: false,
        bot: false,
        active: true,
        muted: false,
        status: "host"
      },
      {
        id: "guest-client",
        name: "Guest",
        host: false,
        spectator: false,
        bot: false,
        active: true,
        muted: false,
        status: "joined"
      }
    ],
    game: {
      matchId: `${code}-match`,
      status: "playing",
      round: 1,
      setup: makeSetup(1),
      powerState: {
        updatedAt: Date.now(),
        hands: [
          { participantId: "host-client", owner: "player", hand: ["shuffle", "software_downgrade"], fresh: [] },
          { participantId: "guest-client", owner: "opponent", hand: ["xray_hacks"], fresh: [] }
        ],
        played: [],
        players: [
          { participantId: "host-client", owner: "player", score: 0, streak: 0 },
          { participantId: "guest-client", owner: "opponent", score: 0, streak: 0 }
        ],
        effects: { maps: {}, arrays: {}, values: {} }
      },
      updatedAt: Date.now()
    }
  }));

  const { response, payload } = await roomPowerStateCommand(code, {
    round: 1,
    powerId: "shuffle",
    actorParticipantId: "host-client",
    hands: [
      { participantId: "host-client", owner: "player", hand: ["shuffle"], fresh: ["shuffle"] }
    ],
    played: [
      {
        participantId: "host-client",
        owner: "player",
        stacks: [{ powerId: "shuffle", revealId: "test-reveal-delta", meta: {} }],
        primaryPowerId: "shuffle"
      }
    ],
    players: [{ participantId: "host-client", owner: "player", score: 100, streak: 1 }],
    effects: { maps: {}, arrays: {}, values: {} }
  });
  assert.equal(response.status, 200, payload.error);

  const stored = await getRoom(code);
  assert.equal(stored.response.status, 200, stored.payload.error);
  const powerState = stored.payload.room.game.powerState;
  assert.ok(powerState.revision >= 1);
  assert.deepEqual(powerState.hands.find((entry) => entry.participantId === "host-client").hand, ["shuffle"]);
  assert.deepEqual(powerState.hands.find((entry) => entry.participantId === "guest-client").hand, ["xray_hacks"]);
  assert.equal(powerState.players.find((entry) => entry.participantId === "guest-client").score, 0);
  assert.equal(powerState.players.find((entry) => entry.participantId === "host-client").score, 100);
  assert.equal(payload.powerState.hands.some((entry) => entry.participantId === "guest-client"), true);
  assert.equal(payload.hands.some((entry) => entry.participantId === "guest-client"), true);
  assert.ok(payload.powerRevision >= 1);

  const events = await request("GET", `/api/rooms/${code}/events?since=0`);
  assert.equal(events.response.status, 200, events.payload.error);
  const event = events.payload.events.find((entry) => entry.type === "power_state" && entry.payload?.powerId === "shuffle");
  assert.ok(event);
  assert.equal(event.payload.powerState.hands.some((entry) => entry.participantId === "guest-client"), true);
}

async function testRoomPowerStateIgnoresStaleHandEntries() {
  const code = makeCode(8118);
  await upsertRoom(makeRoom(code, {
    status: "in-progress",
    participants: [
      {
        id: "host-client",
        name: "Host",
        host: true,
        spectator: false,
        bot: false,
        active: true,
        muted: false,
        status: "host"
      }
    ],
    game: {
      matchId: `${code}-match`,
      status: "playing",
      round: 1,
      setup: makeSetup(1),
      powerState: {
        updatedAt: 2000,
        hands: [
          { participantId: "host-client", owner: "player", updatedAt: 2000, hand: ["shuffle"], fresh: ["shuffle"] }
        ],
        played: [],
        players: [],
        effects: { maps: {}, arrays: {}, values: {} }
      },
      updatedAt: Date.now()
    }
  }));

  const { response, payload } = await roomPowerStateCommand(code, {
    round: 1,
    powerId: "stale-hand",
    actorParticipantId: "host-client",
    hands: [
      { participantId: "host-client", owner: "player", updatedAt: 1000, hand: ["software_downgrade"], fresh: [] }
    ]
  });
  assert.equal(response.status, 200, payload.error);

  const stored = await getRoom(code);
  assert.equal(stored.response.status, 200, stored.payload.error);
  const hand = stored.payload.room.game.powerState.hands.find((entry) => entry.participantId === "host-client");
  assert.deepEqual(hand.hand, ["shuffle"]);
  assert.deepEqual(hand.fresh, ["shuffle"]);
  assert.equal(hand.updatedAt, 2000);
}

async function testStaleRoomPowerStateCannotOverwriteRematchHands() {
  const code = makeCode(8130);
  await upsertRoom(makeRoom(code, {
    status: "in-progress",
    participants: [
      {
        id: "host-client",
        name: "Host",
        host: true,
        spectator: false,
        bot: false,
        active: true,
        muted: false,
        status: "host"
      }
    ],
    game: {
      matchId: `${code}-new-match`,
      status: "playing",
      round: 1,
      setup: makeSetup(1),
      powerState: {
        matchId: `${code}-new-match`,
        updatedAt: 2000,
        hands: [
          { participantId: "host-client", owner: "player", updatedAt: 2000, hand: ["shuffle"], fresh: ["shuffle"] }
        ],
        played: [],
        players: [],
        effects: { maps: {}, arrays: {}, values: {} }
      },
      updatedAt: Date.now()
    }
  }));

  const stale = await roomPowerStateCommand(code, {
    matchId: `${code}-old-match`,
    round: 1,
    powerId: "dead_weight",
    actorParticipantId: "host-client",
    hands: [
      { participantId: "host-client", owner: "player", updatedAt: 3000, hand: ["dead_weight"], fresh: ["dead_weight"] }
    ]
  });
  assert.equal(stale.response.status, 409);

  const stored = await getRoom(code);
  assert.equal(stored.response.status, 200, stored.payload.error);
  const hand = stored.payload.room.game.powerState.hands.find((entry) => entry.participantId === "host-client");
  assert.equal(stored.payload.room.game.matchId, `${code}-new-match`);
  assert.deepEqual(hand.hand, ["shuffle"]);
}

async function testRoomPowerStateCanClearPlayedHistory() {
  const code = makeCode(8116);
  await upsertRoom(makeRoom(code, {
    status: "in-progress",
    participants: [
      {
        id: "host-client",
        name: "Host",
        host: true,
        spectator: false,
        bot: false,
        active: true,
        muted: false,
        status: "host"
      },
      {
        id: "guest-client",
        name: "Guest",
        host: false,
        spectator: false,
        bot: false,
        active: true,
        muted: false,
        status: "joined"
      }
    ],
    game: {
      matchId: `${code}-match`,
      status: "playing",
      round: 1,
      setup: makeSetup(1),
      powerState: {
        updatedAt: Date.now(),
        hands: [
          { participantId: "host-client", owner: "player", hand: ["shuffle"], fresh: [] },
          { participantId: "guest-client", owner: "opponent", hand: ["xray_hacks"], fresh: [] }
        ],
        played: [
          {
            participantId: "host-client",
            owner: "player",
            stacks: [{ powerId: "shuffle", revealId: "old-host-power", meta: {} }],
            primaryPowerId: "shuffle",
            meta: {}
          },
          {
            participantId: "guest-client",
            owner: "opponent",
            stacks: [{ powerId: "xray_hacks", revealId: "old-guest-power", meta: {} }],
            primaryPowerId: "xray_hacks",
            meta: {}
          }
        ],
        players: [
          { participantId: "host-client", owner: "player", score: 100, streak: 1 },
          { participantId: "guest-client", owner: "opponent", score: 50, streak: 0 }
        ],
        effects: { maps: {}, arrays: {}, values: {} }
      },
      updatedAt: Date.now()
    }
  }));

  const { response, payload } = await roomPowerStateCommand(code, {
    round: 1,
    powerId: "round-reset",
    played: [
      { participantId: "host-client", owner: "player", stacks: [], primaryPowerId: "", meta: null },
      { participantId: "guest-client", owner: "opponent", stacks: [], primaryPowerId: "", meta: null }
    ]
  });
  assert.equal(response.status, 200, payload.error);

  const stored = await getRoom(code);
  assert.equal(stored.response.status, 200, stored.payload.error);
  const powerState = stored.payload.room.game.powerState;
  assert.deepEqual(powerState.hands.find((entry) => entry.participantId === "host-client").hand, ["shuffle"]);
  assert.deepEqual(powerState.hands.find((entry) => entry.participantId === "guest-client").hand, ["xray_hacks"]);
  assert.deepEqual(powerState.played.find((entry) => entry.participantId === "host-client").stacks, []);
  assert.deepEqual(powerState.played.find((entry) => entry.participantId === "guest-client").stacks, []);
  assert.equal(powerState.played.find((entry) => entry.participantId === "host-client").primaryPowerId, "");
  assert.equal(powerState.played.find((entry) => entry.participantId === "guest-client").primaryPowerId, "");
}

async function testSpectatorCannotUpdateRoomPowerState() {
  const code = makeCode(8135);
  await upsertRoom(makeRoom(code, {
    status: "in-progress",
    participants: [
      {
        id: "host-client",
        name: "Host",
        host: true,
        spectator: false,
        bot: false,
        active: true,
        muted: false,
        status: "host"
      }
    ],
    game: {
      matchId: `${code}-match`,
      status: "playing",
      round: 1,
      setup: makeSetup(1),
      powerState: {
        matchId: `${code}-match`,
        revision: 2,
        updatedAt: 2000,
        hands: [
          { participantId: "host-client", owner: "player", revision: 2, updatedAt: 2000, hand: ["shuffle"], fresh: [] }
        ],
        played: [],
        players: [{ participantId: "host-client", owner: "player", revision: 2, updatedAt: 2000, score: 0, streak: 0 }],
        effects: { maps: {}, arrays: {}, values: {} }
      },
      updatedAt: Date.now()
    }
  }));
  const presence = await roomPresenceCommand(code, {
    compact: true,
    participant: {
      id: "spectator-client",
      name: "Spectator",
      role: "spectator",
      spectator: true,
      active: true,
      status: "spectating"
    }
  });
  assert.equal(presence.response.status, 200, presence.payload.error);
  const response = await roomPowerStateCommand(code, {
    matchId: `${code}-match`,
    round: 1,
    powerId: "shuffle",
    actorParticipantId: "spectator-client",
    hands: [
      { participantId: "host-client", owner: "player", updatedAt: 3000, hand: ["dead_weight"], fresh: [] }
    ]
  }, roomParticipantCookieHeader(code, "spectator-client"));
  assert.equal(response.response.status, 403);

  const stored = await getRoom(code);
  assert.equal(stored.response.status, 200, stored.payload.error);
  const hostHand = stored.payload.room.game.powerState.hands.find((entry) => entry.participantId === "host-client");
  assert.deepEqual(hostHand.hand, ["shuffle"]);
}

async function testRoomRoundSkipEndpointStampsEvent() {
  const code = makeCode(8117);
  await upsertRoom(makeRoom(code, {
    status: "in-progress",
    participants: [
      {
        id: "host-client",
        name: "Host",
        host: true,
        spectator: false,
        bot: false,
        active: true,
        muted: false,
        status: "host"
      },
      {
        id: "guest-client",
        name: "Guest",
        host: false,
        spectator: false,
        bot: false,
        active: true,
        muted: false,
        status: "joined"
      }
    ],
    game: {
      matchId: `${code}-match`,
      status: "playing",
      round: 2,
      setup: makeSetup(2),
      updatedAt: Date.now()
    }
  }));

  const { response, payload } = await roomRoundSkipCommand(code, {
    hostParticipantId: "host-client",
    round: 2,
    submissions: [
      { participantId: "host-client", owner: "player", answer: "Host answer", remainingTime: 14 },
      { participantId: "guest-client", owner: "opponent", answer: "", remainingTime: 0 }
    ]
  });
  assert.equal(response.status, 200, payload.error);
  assert.equal(payload.eventType, "round-grading");
  assert.equal(payload.reason, "host-skip");
  assert.equal(payload.submissions.length, 2);
  assert.ok(payload.revision >= 2);

  const stored = await getRoom(code);
  assert.equal(stored.response.status, 200, stored.payload.error);
  const host = stored.payload.room.participants.find((participant) => participant.id === "host-client");
  const guest = stored.payload.room.participants.find((participant) => participant.id === "guest-client");
  assert.equal(host.answer, "Host answer");
  assert.equal(host.submittedRound, 2);
  assert.equal(guest.answer, "");
  assert.equal(guest.submittedRound, 2);
  assert.equal(stored.payload.room.game.status, "grading");
  assert.equal(stored.payload.room.game.answers["host-client"].answer, "Host answer");
  assert.equal(stored.payload.room.game.answers["guest-client"].answer, "");
  assert.equal(stored.payload.room.events.some((event) => event.type === "round_grading"), true);
}

async function testRoomGradingAllSubmittedDoesNotForcePendingAnswers() {
  const code = makeCode(8168);
  const matchId = `${code}-match`;
  await upsertRoom(makeRoom(code, {
    status: "in-progress",
    participants: [
      {
        id: "host-client",
        name: "Host",
        host: true,
        spectator: false,
        bot: false,
        active: true,
        muted: false,
        status: "submitted",
        answer: "Host answer",
        submittedRound: 2,
        submissionMatchId: matchId,
        remainingTime: 12
      },
      {
        id: "guest-client",
        name: "Guest",
        host: false,
        spectator: false,
        bot: false,
        active: true,
        muted: false,
        status: "joined"
      }
    ],
    game: {
      matchId,
      status: "playing",
      round: 2,
      setup: makeSetup(2),
      answers: {
        "host-client": {
          participantId: "host-client",
          matchId,
          round: 2,
          status: "submitted",
          answer: "Host answer",
          remainingTime: 12,
          submittedAt: Date.now()
        }
      },
      updatedAt: Date.now()
    }
  }));

  const grading = await roomGradingCommand(code, {
    hostParticipantId: "host-client",
    matchId,
    round: 2,
    reason: "all-submitted",
    submissions: [
      { participantId: "host-client", owner: "player", answer: "Host answer", remainingTime: 12 }
    ]
  });
  assert.equal(grading.response.status, 409);
  assert.deepEqual(grading.payload.pendingParticipantIds, ["guest-client"]);

  const stored = await getRoom(code);
  assert.equal(stored.response.status, 200, stored.payload.error);
  assert.equal(stored.payload.room.game.status, "playing");
  assert.equal(stored.payload.room.game.answers["guest-client"], undefined);
}

async function testRoomGradingAllSubmittedLocksWhenAllAnswersPresent() {
  const code = makeCode(8169);
  const matchId = `${code}-match`;
  await upsertRoom(makeRoom(code, {
    status: "in-progress",
    participants: [
      {
        id: "host-client",
        name: "Host",
        host: true,
        spectator: false,
        bot: false,
        active: true,
        muted: false,
        status: "submitted",
        answer: "Host answer",
        submittedRound: 2,
        submissionMatchId: matchId,
        remainingTime: 12
      },
      {
        id: "guest-client",
        name: "Guest",
        host: false,
        spectator: false,
        bot: false,
        active: true,
        muted: false,
        status: "submitted",
        answer: "Guest answer",
        submittedRound: 2,
        submissionMatchId: matchId,
        remainingTime: 9
      }
    ],
    game: {
      matchId,
      status: "playing",
      round: 2,
      setup: makeSetup(2),
      answers: {
        "host-client": {
          participantId: "host-client",
          matchId,
          round: 2,
          status: "submitted",
          answer: "Host answer",
          remainingTime: 12,
          submittedAt: Date.now() - 2000
        },
        "guest-client": {
          participantId: "guest-client",
          matchId,
          round: 2,
          status: "submitted",
          answer: "Guest answer",
          remainingTime: 9,
          submittedAt: Date.now() - 1000
        }
      },
      updatedAt: Date.now()
    }
  }));

  const grading = await roomGradingCommand(code, {
    hostParticipantId: "host-client",
    matchId,
    round: 2,
    reason: "all-submitted",
    submissions: [
      { participantId: "host-client", owner: "player", answer: "Host answer", remainingTime: 12 },
      { participantId: "guest-client", owner: "opponent", answer: "Guest answer", remainingTime: 9 }
    ]
  });
  assert.equal(grading.response.status, 200, grading.payload.error);
  assert.equal(grading.payload.eventType, "round-grading");
  assert.equal(grading.payload.reason, "all-submitted");
  assert.equal(grading.payload.submissions.length, 2);
  const deliveredGradingEvent = grading.payload.events.find((event) => event.type === "round_grading");
  assert.ok(deliveredGradingEvent, "The shared grading handoff should be returned to joined players.");
  assert.equal(deliveredGradingEvent.payload.game.powerState, undefined, "Power state must not be included in the grading handoff.");

  const stored = await getRoom(code);
  assert.equal(stored.response.status, 200, stored.payload.error);
  assert.equal(stored.payload.room.game.status, "grading");
  assert.equal(stored.payload.room.events.some((event) => event.type === "round_grading"), true);
}

async function testRoomGradingAllSubmittedAcceptsForcedBotSubmission() {
  const code = makeCode(8179);
  const matchId = `${code}-match`;
  await upsertRoom(makeRoom(code, {
    status: "in-progress",
    participants: [
      {
        id: "host-client",
        name: "Host",
        host: true,
        spectator: false,
        bot: false,
        active: true,
        muted: false,
        status: "submitted",
        answer: "Host answer",
        submittedRound: 1,
        submissionMatchId: matchId,
        remainingTime: 14
      },
      {
        id: "guest-client",
        name: "Guest",
        host: false,
        spectator: false,
        bot: false,
        active: true,
        muted: false,
        status: "submitted",
        answer: "Guest answer",
        submittedRound: 1,
        submissionMatchId: matchId,
        remainingTime: 11
      },
      {
        id: "bot-client",
        name: "Bot",
        host: false,
        spectator: false,
        bot: true,
        role: "bot",
        active: true,
        muted: false,
        status: "bot"
      }
    ],
    game: {
      matchId,
      status: "playing",
      round: 1,
      setup: makeSetup(1),
      answers: {
        "host-client": {
          participantId: "host-client",
          matchId,
          round: 1,
          status: "submitted",
          answer: "Host answer",
          remainingTime: 14,
          submittedAt: Date.now() - 2000
        },
        "guest-client": {
          participantId: "guest-client",
          matchId,
          round: 1,
          status: "submitted",
          answer: "Guest answer",
          remainingTime: 11,
          submittedAt: Date.now() - 1000
        }
      },
      updatedAt: Date.now()
    }
  }));

  const grading = await roomGradingCommand(code, {
    hostParticipantId: "host-client",
    matchId,
    round: 1,
    reason: "all-submitted",
    force: false,
    submissions: [
      { participantId: "host-client", owner: "player", answer: "Host answer", remainingTime: 14 },
      { participantId: "guest-client", owner: "opponent", answer: "Guest answer", remainingTime: 11 },
      { participantId: "bot-client", owner: "roomBotTest", answer: "Bot answer", remainingTime: 8, autoSubmitted: true }
    ]
  });
  assert.equal(grading.response.status, 200, grading.payload.error);
  assert.equal(grading.payload.eventType, "round-grading");
  assert.equal(grading.payload.reason, "all-submitted");
  assert.equal(grading.payload.submissions.length, 3);

  const stored = await getRoom(code);
  assert.equal(stored.response.status, 200, stored.payload.error);
  assert.equal(stored.payload.room.game.status, "grading");
  assert.equal(stored.payload.room.game.answers["bot-client"].answer, "Bot answer");
  assert.equal(stored.payload.room.game.answers["bot-client"].autoSubmitted, true);
}

async function testRoomRoundResultRequiresGradingLock() {
  const code = makeCode(8165);
  const matchId = `${code}-match`;
  await upsertRoom(makeRoom(code, {
    status: "in-progress",
    participants: [
      {
        id: "host-client",
        name: "Host",
        host: true,
        spectator: false,
        bot: false,
        active: true,
        muted: false,
        status: "host"
      },
      {
        id: "guest-client",
        name: "Guest",
        host: false,
        spectator: false,
        bot: false,
        active: true,
        muted: false,
        status: "joined"
      }
    ],
    game: {
      matchId,
      status: "playing",
      round: 2,
      setup: makeSetup(2),
      answers: {},
      updatedAt: Date.now()
    }
  }));

  const earlyResult = await roomRoundResultCommand(code, {
    hostParticipantId: "host-client",
    roundResult: makeRoundResult(2, { matchId })
  });
  assert.equal(earlyResult.response.status, 409);

  const grading = await roomGradingCommand(code, {
    hostParticipantId: "host-client",
    matchId,
    round: 2,
    submissions: [
      { participantId: "host-client", owner: "player", answer: "Host answer", remainingTime: 12 },
      { participantId: "guest-client", owner: "opponent", answer: "Guest answer", remainingTime: 7 }
    ]
  });
  assert.equal(grading.response.status, 200, grading.payload.error);
  assert.equal(grading.payload.eventType, "round-grading");

  const lockedResult = await roomRoundResultCommand(code, {
    hostParticipantId: "host-client",
    roundResult: makeRoundResult(2, {
      matchId,
      tableEvent: { id: "gamblers_dice", name: "Gambler's Dice" },
      resultSummary: {
        judgements: [
          {
            index: 0,
            participantId: "host-client",
            owner: "player",
            answer: "Answer",
            correct: true,
            tag: "Exact",
            bonus: 150,
            reason: "That matched the answer cleanly.",
            aiReviewed: false,
            aiSecondOpinion: false
          }
        ],
        scoreDeltas: [
          {
            participantId: "host-client",
            owner: "player",
            label: "Host",
            delta: 1200,
            scoreBefore: 0,
            scoreAfter: 1200,
            streakBefore: 0,
            streakAfter: 1,
            streakDelta: 1,
            correct: true,
            tag: "Exact"
          }
        ],
        leaderboard: [
          {
            rank: 1,
            participantId: "host-client",
            owner: "player",
            label: "Host",
            score: 1200,
            displayScore: "1,200 points",
            hiddenScore: false,
            streak: 1,
            delta: 1200,
            correct: true,
            tag: "Exact"
          }
        ],
        powerEvents: [{ text: "Pocket Bounty paid out.", owner: "player", participantId: "host-client", powerId: "bounty", rarity: "green", name: "Pocket Bounty" }],
        activeEffects: [{ owner: "player", participantId: "host-client", label: "Host", name: "Pocket Shield", description: "Blocks the next point loss.", rarity: "green", powerId: "shield" }]
      }
    })
  });
  assert.equal(lockedResult.response.status, 200, lockedResult.payload.error);
  assert.equal(lockedResult.payload.eventType, "round-result");
  const deliveredResultEvent = lockedResult.payload.events.find((event) => event.type === "round_result");
  assert.ok(deliveredResultEvent, "The authoritative round result should be returned to the host and broadcast to joined players.");
  assert.equal(deliveredResultEvent.payload.game.roundResult, undefined, "The result must not be duplicated inside the realtime game envelope.");
  assert.equal(deliveredResultEvent.payload.game.powerState, undefined, "The complete result owns the power state for this transition.");
  assert.equal(deliveredResultEvent.payload.game.setup.id, "test-question-2");
  assert.equal(deliveredResultEvent.payload.roundResult.tableEvent?.id, "gamblers_dice");
  assert.equal(deliveredResultEvent.payload.roundResult.resultSummary.leaderboard[0].score, 1200);
  assert.equal(lockedResult.payload.roundResult.resultSummary.judgements[0].reason, "That matched the answer cleanly.");
  assert.equal(lockedResult.payload.roundResult.resultSummary.scoreDeltas[0].delta, 1200);
  assert.equal(lockedResult.payload.roundResult.resultSummary.leaderboard[0].rank, 1);

  const duplicateResult = await roomRoundResultCommand(code, {
    hostParticipantId: "host-client",
    roundResult: makeRoundResult(2, {
      matchId,
      resultSummary: {
        scoreDeltas: [
          {
            participantId: "host-client",
            owner: "player",
            label: "Host",
            delta: 9999,
            scoreBefore: 0,
            scoreAfter: 9999,
            streakBefore: 0,
            streakAfter: 9,
            streakDelta: 9,
            correct: true,
            tag: "Duplicate"
          }
        ]
      }
    })
  });
  assert.equal(duplicateResult.response.status, 200, duplicateResult.payload.error);
  assert.equal(duplicateResult.payload.duplicate, true);
  assert.equal(duplicateResult.payload.roundResult.resultSummary.scoreDeltas[0].delta, 1200);
  const replayedResultEvent = duplicateResult.payload.events.find((event) => event.type === "round_result");
  assert.ok(replayedResultEvent, "A duplicate result publish should replay the canonical round-result event.");
  assert.equal(replayedResultEvent.payload.roundResult.resultSummary.scoreDeltas[0].delta, 1200);

  const stored = await getRoom(code);
  assert.equal(stored.response.status, 200, stored.payload.error);
  assert.equal(stored.payload.room.game.status, "grading");
  assert.equal(stored.payload.room.game.roundResult.questionId, "test-question-2");
  assert.equal(stored.payload.room.game.roundResult.resultSummary.scoreDeltas[0].delta, 1200);
  assert.equal(stored.payload.room.game.roundResult.resultSummary.powerEvents[0].text, "Pocket Bounty paid out.");
  assert.equal(stored.payload.room.events.some((event) => event.type === "round_result" && event.payload?.roundResult?.resultSummary?.activeEffects?.[0]?.name === "Pocket Shield"), true);
}

async function testRoomModerationEndpointMutesAndBans() {
  const code = makeCode(8114);
  await upsertRoom(makeRoom(code, {
    participants: [
      {
        id: "host-client",
        name: "Host",
        host: true,
        spectator: false,
        bot: false,
        active: true,
        muted: false,
        status: "host"
      },
      {
        id: "guest-client",
        name: "Guest",
        host: false,
        spectator: false,
        bot: false,
        active: true,
        muted: false,
        status: "joined"
      }
    ]
  }));

  const muteClientEventId = `${code}:mute:event`;
  const mute = await roomModerationCommand(code, {
    clientEventId: muteClientEventId,
    hostParticipantId: "host-client",
    participantId: "guest-client",
    action: "mute"
  });
  assert.equal(mute.response.status, 200, mute.payload.error);
  assert.equal(mute.payload.clientEventId, muteClientEventId);
  assert.equal(mute.payload.participant.muted, true);

  const ban = await roomModerationCommand(code, {
    hostParticipantId: "host-client",
    participantId: "guest-client",
    action: "ban"
  });
  assert.equal(ban.response.status, 200, ban.payload.error);
  assert.equal(ban.payload.banned.includes("guest-client"), true);
  assert.equal(ban.payload.room.code, code);
  assert.equal(ban.payload.room.participants.some((participant) => participant.id === "guest-client"), false);

  const stored = await getRoom(code);
  assert.equal(stored.response.status, 200, stored.payload.error);
  assert.equal(stored.payload.room.participants.some((participant) => participant.id === "guest-client"), false);
  assert.equal(stored.payload.room.events.some((event) => event.type === "participant_moderated"), true);
  assert.equal(stored.payload.room.events.some((event) => event.type === "participant_moderated" && event.payload?.clientEventId === muteClientEventId), true);
}

async function testKickedParticipantCanRejoinWithSameProfile() {
  const code = makeCode(8147);
  await upsertRoom(makeRoom(code, {
    participants: [
      {
        id: "host-client",
        name: "Host",
        host: true,
        spectator: false,
        bot: false,
        active: true,
        muted: false,
        status: "host"
      },
      {
        id: "kickable-client",
        profileUserId: "guest:kickable-profile",
        name: "Kickable",
        host: false,
        spectator: false,
        bot: false,
        active: true,
        muted: false,
        status: "joined"
      }
    ]
  }));

  const kick = await roomModerationCommand(code, {
    hostParticipantId: "host-client",
    participantId: "kickable-client",
    action: "kick"
  });
  assert.equal(kick.response.status, 200, kick.payload.error);
  assert.equal(kick.payload.participant.active, false);
  assert.equal(kick.payload.participant.status, "kicked");

  const rejoin = await roomPresenceCommand(code, {
    participant: {
      id: "kickable-rejoin-client",
      profileUserId: "guest:kickable-profile",
      name: "Kickable",
      active: true,
      status: "joined"
    }
  });
  assert.equal(rejoin.response.status, 200, rejoin.payload.error);
  assert.equal(rejoin.payload.room.participants.some((participant) => participant.id === "kickable-client"), false);
  const participant = rejoin.payload.room.participants.find((entry) => entry.id === "kickable-rejoin-client");
  assert.equal(participant.active, true);
  assert.equal(participant.role, "player");
  assert.equal(rejoin.payload.room.activePlayers, 2);
}

async function testBannedParticipantProfileCannotRejoinWithNewId() {
  const code = makeCode(8148);
  await upsertRoom(makeRoom(code, {
    participants: [
      {
        id: "host-client",
        name: "Host",
        host: true,
        spectator: false,
        bot: false,
        active: true,
        muted: false,
        status: "host"
      },
      {
        id: "banned-client",
        profileUserId: "guest:banned-profile",
        name: "Banned",
        host: false,
        spectator: false,
        bot: false,
        active: true,
        muted: false,
        status: "joined"
      }
    ]
  }));

  const ban = await roomModerationCommand(code, {
    hostParticipantId: "host-client",
    participantId: "banned-client",
    action: "ban"
  });
  assert.equal(ban.response.status, 200, ban.payload.error);
  assert.equal(ban.payload.banned.includes("guest:banned-profile"), true);

  const rejoin = await roomPresenceCommand(code, {
    participant: {
      id: "banned-rejoin-client",
      profileUserId: "guest:banned-profile",
      name: "Banned",
      active: true,
      status: "joined"
    }
  });
  assert.equal(rejoin.response.status, 403);

  const stored = await getRoom(code);
  assert.equal(stored.response.status, 200, stored.payload.error);
  assert.equal(stored.payload.room.participants.some((participant) => participant.id === "banned-rejoin-client"), false);
  assert.equal(stored.payload.room.banned.includes("guest:banned-profile"), true);
}

async function testRoomPresenceRejectsBotWhenRoomFull() {
  const code = makeCode(8149);
  await upsertRoom(makeRoom(code, {
    settings: {
      ...makeRoom(code).settings,
      maxPlayers: 2
    },
    participants: [
      {
        id: "host-client",
        name: "Host",
        host: true,
        spectator: false,
        bot: false,
        active: true,
        muted: false,
        status: "host"
      },
      {
        id: "second-client",
        profileUserId: "guest:second-client",
        name: "Second",
        host: false,
        spectator: false,
        bot: false,
        active: true,
        muted: false,
        status: "joined"
      }
    ]
  }));

  const added = await roomPresenceCommand(code, {
    hostParticipantId: "host-client",
    compact: true,
    participant: {
      id: "overfill-bot-client",
      name: "Extra Bot",
      role: "bot",
      active: true,
      status: "bot"
    }
  });
  assert.equal(added.response.status, 409);
  assert.match(added.payload.error, /full/i);

  const stored = await getRoom(code);
  assert.equal(stored.response.status, 200, stored.payload.error);
  assert.equal(stored.payload.room.participants.some((participant) => participant.id === "overfill-bot-client"), false);
  assert.equal(stored.payload.room.activePlayers, 2);
}

async function testRoomModerationEndpointKicksBot() {
  const code = makeCode(8116);
  await upsertRoom(makeRoom(code, {
    status: "in-progress",
    participants: [
      {
        id: "host-client",
        name: "Host",
        host: true,
        spectator: false,
        bot: false,
        active: true,
        muted: false,
        status: "host"
      },
      {
        id: "bot-client",
        name: "Trivia Bot",
        host: false,
        spectator: false,
        bot: true,
        active: true,
        muted: false,
        status: "bot",
        submittedRound: 1,
        remainingTime: 0
      }
    ],
    game: {
      matchId: `${code}-match`,
      status: "playing",
      round: 1,
      setup: makeSetup(1),
      updatedAt: Date.now()
    }
  }));

  const { response, payload } = await roomModerationCommand(code, {
    hostParticipantId: "host-client",
    participantId: "bot-client",
    action: "kick"
  });
  assert.equal(response.status, 200, payload.error);
  assert.equal(payload.participant.active, false);
  assert.equal(payload.participant.bot, true);
  assert.equal(payload.room.code, code);
  assert.equal(payload.room.participants.some((participant) => participant.id === "bot-client"), false);

  const stored = await getRoom(code);
  assert.equal(stored.response.status, 200, stored.payload.error);
  const storedBot = stored.payload.room.participants.find((participant) => participant.id === "bot-client");
  assert.equal(storedBot, undefined);
  assert.equal(stored.payload.room.activePlayers, 1);
  assert.equal(stored.payload.room.events.some((event) => event.type === "participant_moderated" && event.payload.participantId === "bot-client"), true);

  const added = await roomPresenceCommand(code, {
    hostParticipantId: "host-client",
    compact: true,
    participant: {
      id: "bot-client-2",
      name: "Replacement Bot",
      host: false,
      spectator: false,
      bot: true,
      active: true,
      muted: false,
      status: "bot"
    }
  });
  assert.equal(added.response.status, 409);

  const storedAfterAdd = await getRoom(code);
  assert.equal(storedAfterAdd.response.status, 200, storedAfterAdd.payload.error);
  assert.equal(storedAfterAdd.payload.room.participants.some((participant) => participant.id === "bot-client"), false);
  assert.equal(storedAfterAdd.payload.room.participants.some((participant) => participant.id === "bot-client-2"), false);
  assert.equal(storedAfterAdd.payload.room.activePlayers, 1);
}

async function testRapidRoomBotAddsAreSerializedAndUnique() {
  const code = makeCode(8188);
  await upsertRoom(makeRoom(code, {
    settings: {
      ...makeRoom(code).settings,
      maxPlayers: 5
    }
  }));

  const adds = await Promise.all([0, 1, 2].map((index) => roomCommand(code, "add_bot", {
    participantId: "host-client",
    name: "Rapid Bot",
    clientEventId: `rapid-bot-${index}`
  })));
  adds.forEach(({ response, payload }) => {
    assert.equal(response.status, 200, payload.error);
  });

  const stored = await getRoom(code);
  assert.equal(stored.response.status, 200, stored.payload.error);
  const bots = stored.payload.room.participants.filter((participant) => participant.bot);
  assert.equal(bots.length, 3);
  assert.equal(new Set(bots.map((bot) => bot.id)).size, 3);
  assert.equal(new Set(bots.map((bot) => bot.name)).size, 3);
  assert.equal(stored.payload.room.activePlayers, 4);
}

async function testRequestedRoomBotIdCanBeKicked() {
  const code = makeCode(8191);
  const botId = "bot-requested-8191";
  await upsertRoom(makeRoom(code));

  const added = await roomCommand(code, "add_bot", {
    participantId: "host-client",
    botId,
    name: "Kickable Bot",
    participant: {
      id: botId,
      name: "Kickable Bot",
      role: "bot",
      bot: true,
      active: true,
      status: "bot"
    }
  });
  assert.equal(added.response.status, 200, added.payload.error);

  const afterAdd = await getRoom(code);
  assert.equal(afterAdd.response.status, 200, afterAdd.payload.error);
  assert.equal(afterAdd.payload.room.participants.some((participant) => participant.id === botId && participant.bot), true);

  const kicked = await roomModerationCommand(code, {
    hostParticipantId: "host-client",
    participantId: botId,
    action: "kick"
  });
  assert.equal(kicked.response.status, 200, kicked.payload.error);
  assert.equal(kicked.payload.participant.id, botId);
  assert.equal(kicked.payload.room.participants.some((participant) => participant.id === botId), false);
}

async function testModerationCommandUsesTargetParticipantId() {
  const code = makeCode(8193);
  const botId = "bot-target-8193";
  await upsertRoom(makeRoom(code));

  const added = await roomCommand(code, "add_bot", {
    participantId: "host-client",
    botId,
    name: "Target Bot",
    participant: {
      id: botId,
      name: "Target Bot",
      role: "bot",
      bot: true,
      active: true,
      status: "bot"
    }
  });
  assert.equal(added.response.status, 200, added.payload.error);

  const kicked = await request("POST", `/api/rooms/${code}/commands`, {
    type: "moderate_participant",
    roomCode: code,
    participantId: "host-client",
    clientEventId: `${code}:target-kick`,
    payload: {
      participantId: "host-client",
      hostParticipantId: "host-client",
      targetParticipantId: botId,
      action: "kick"
    }
  });
  assert.equal(kicked.response.status, 200, kicked.payload.error);
  assert.equal(kicked.payload.events.some((event) => event.type === "participant_moderated" && event.payload.participantId === botId), true);

  const stored = await getRoom(code);
  assert.equal(stored.response.status, 200, stored.payload.error);
  assert.equal(stored.payload.room.participants.some((participant) => participant.id === botId), false);
}

async function testJoinedRoomParticipantIdCanBeModerated() {
  const code = makeCode(8192);
  await upsertRoom(makeRoom(code));

  const joined = await roomPresenceCommand(code, {
    participantId: "guest-client",
    compact: true,
    participant: {
      id: "guest-client",
      profileUserId: "guest-profile",
      name: "Guest",
      host: false,
      spectator: false,
      bot: false,
      active: true,
      muted: false,
      status: "joined"
    }
  });
  assert.equal(joined.response.status, 200, joined.payload.error);
  assert.equal(joined.payload.participant.id, "guest-client");

  const muted = await roomModerationCommand(code, {
    hostParticipantId: "host-client",
    participantId: "guest-client",
    action: "mute"
  });
  assert.equal(muted.response.status, 200, muted.payload.error);
  assert.equal(muted.payload.participant.id, "guest-client");
  assert.equal(muted.payload.participant.muted, true);

  const kicked = await roomModerationCommand(code, {
    hostParticipantId: "host-client",
    participantId: "guest-client",
    action: "kick"
  });
  assert.equal(kicked.response.status, 200, kicked.payload.error);
  assert.equal(kicked.payload.participant.id, "guest-client");
  assert.equal(kicked.payload.participant.status, "kicked");
}

async function testHostCloseEndpointDeletesRoom() {
  const code = makeCode(8115);
  await upsertRoom(makeRoom(code));
  const { response, payload } = await roomCloseCommand(code, {
    participantId: "host-client",
    reason: "manual"
  });
  assert.equal(response.status, 200, payload.error);
  assert.equal(payload.closed, true);
  assert.equal(payload.reason, "host-left");
  const directRoom = await getRoom(code);
  assert.equal(directRoom.response.status, 410);
  assert.equal(directRoom.payload.close.reason, "host-left");
}

async function testAdminClosePublishesAuthoritativeRoomClosedEvent() {
  const code = makeCode(8116);
  await upsertRoom(makeRoom(code));
  const { response, payload } = await request("POST", `/api/admin/rooms/${code}/close`, undefined, adminHeaders());
  assert.equal(response.status, 200, payload.error);
  assert.equal(payload.room.status, "complete");
  assert.equal(payload.events.some((event) => event.type === "room_closed"), true);
  assert.equal(payload.events.find((event) => event.type === "room_closed")?.payload.reason, "admin");
}

async function testUserInventoryOpsAreIdempotent() {
  const userId = "inventory-user-idempotent";
  const coinOps = [
    { id: "inv-coin-start", type: "coin", delta: 500, reason: "test" }
  ];
  let result = await request("POST", "/api/user/inventory/ops", { userId, ops: coinOps });
  assert.equal(result.response.status, 200, result.payload.error);
  assert.equal(result.payload.inventory.coins, 500);
  assert.deepEqual(result.payload.applied, ["inv-coin-start"]);

  result = await request("POST", "/api/user/inventory/ops", { userId, ops: coinOps });
  assert.equal(result.response.status, 200, result.payload.error);
  assert.equal(result.payload.inventory.coins, 500);
  assert.equal(result.payload.skipped[0].reason, "already-applied");

  const fetched = await request("GET", `/api/user/inventory?userId=${userId}`);
  assert.equal(fetched.response.status, 200, fetched.payload.error);
  assert.equal(fetched.payload.inventory.coins, 500);
  assert.equal(fetched.payload.inventory.coinTransactions.length, 1);
}

async function testUserInventoryCoinReconcilePersistsExitBalance() {
  const userId = "inventory-user-coin-reconcile";
  const seed = await request("POST", "/api/user/inventory/ops", {
    userId,
    ops: [{ id: "coin-reconcile-seed", type: "coin", delta: 100, reason: "seed" }]
  });
  assert.equal(seed.response.status, 200, seed.payload.error);
  assert.equal(seed.payload.inventory.coins, 100);

  const reconcile = await request("POST", "/api/user/inventory/ops", {
    userId,
    ops: [{
      id: "state-coin-reconcile-150",
      type: "coin",
      mode: "reconcile",
      value: 150,
      reason: "state-sync",
      coveredCoinOps: [{ id: "pending-round-win", delta: 50 }]
    }]
  });
  assert.equal(reconcile.response.status, 200, reconcile.payload.error);
  assert.equal(reconcile.payload.inventory.coins, 150);

  const replay = await request("POST", "/api/user/inventory/ops", {
    userId,
    ops: [{ id: "pending-round-win", type: "coin", delta: 50, reason: "round-win" }]
  });
  assert.equal(replay.response.status, 200, replay.payload.error);
  assert.equal(replay.payload.inventory.coins, 150);
  assert.equal(replay.payload.skipped[0].reason, "already-applied");

  const lower = await request("POST", "/api/user/inventory/ops", {
    userId,
    ops: [{ id: "state-coin-reconcile-120", type: "coin", mode: "max", value: 120, reason: "state-sync" }]
  });
  assert.equal(lower.response.status, 200, lower.payload.error);
  assert.equal(lower.payload.inventory.coins, 150);
}

async function testUserInventoryPurchaseAndUnlockRowsPersist() {
  const userId = "inventory-user-purchase";
  const shopItem = getTestRotatingShopItem();
  const cardCustomization = shopItem.type === "font"
    ? { fontId: shopItem.id, titleColourId: "rarity" }
    : { patternId: shopItem.id, titleColourId: "rarity" };
  const { response, payload } = await request("POST", "/api/user/inventory/ops", {
    userId,
    ops: [
      { id: "purchase-seed-coins", type: "coin", delta: 300, reason: "seed" },
      { id: "purchase-rotating-cosmetic", type: "purchase-cosmetic", key: shopItem.key, cost: 1, purchaseAt: Date.now() },
      { id: "unlock-first-blood", type: "achievement", achievementId: "first-blood", record: { source: "test" } },
      { id: "progress-room-regular", type: "achievement-progress", key: "publicMatchesFinished", value: 10, mode: "set" },
      { id: "milestone-five", type: "milestone", milestoneId: "achievements-5", coinDelta: 100 },
      {
        id: "profile-prefix",
        type: "profile",
        profile: {
          equippedAchievementId: "first-blood",
          cardCustomization
        }
      }
    ]
  });
  assert.equal(response.status, 200, payload.error);
  assert.equal(payload.inventory.coins, 400 - shopItem.cost);
  assert.deepEqual(payload.inventory.cosmetics, [shopItem.key]);
  assert.ok(payload.inventory.achievements["first-blood"]);
  assert.equal(payload.inventory.achievementProgress.publicMatchesFinished, 10);
  assert.deepEqual(payload.inventory.claimedMilestones, ["achievements-5"]);
  assert.equal(payload.inventory.profile.equippedAchievementId, "first-blood");
  Object.entries(cardCustomization).forEach(([key, value]) => {
    assert.equal(payload.inventory.profile.cardCustomization[key], value);
  });

  const duplicate = await request("POST", "/api/user/inventory/ops", {
    userId,
    ops: [
      { id: "purchase-rotating-cosmetic", type: "purchase-cosmetic", key: shopItem.key, cost: 1, purchaseAt: Date.now() },
      { id: "milestone-five", type: "milestone", milestoneId: "achievements-5", coinDelta: 50 }
    ]
  });
  assert.equal(duplicate.response.status, 200, duplicate.payload.error);
  assert.equal(duplicate.payload.inventory.coins, 400 - shopItem.cost);
  assert.deepEqual(duplicate.payload.inventory.cosmetics, [shopItem.key]);
}

async function testUserInventoryEconomyValuesUseServerCatalog() {
  const userId = "inventory-user-economy-catalog";
  const shopItem = getTestRotatingShopItem();
  const { response, payload } = await request("POST", "/api/user/inventory/ops", {
    userId,
    ops: [
      { id: "catalog-seed-coins", type: "coin", delta: 300, reason: "seed" },
      { id: "catalog-cheap-rotating", type: "purchase-cosmetic", key: shopItem.key, cost: 1, purchaseAt: Date.now() },
      { id: "catalog-free-unknown", type: "purchase-cosmetic", key: "font:not-real", cost: 0 },
      { id: "catalog-inflated-milestone", type: "milestone", milestoneId: "achievements-10", coinDelta: 999999 },
      { id: "catalog-unknown-milestone", type: "milestone", milestoneId: "achievements-999", coinDelta: 1000 }
    ]
  });
  assert.equal(response.status, 200, payload.error);
  assert.equal(payload.inventory.coins, 500 - shopItem.cost);
  assert.deepEqual(payload.inventory.cosmetics, [shopItem.key]);
  assert.deepEqual(payload.inventory.claimedMilestones, ["achievements-10"]);
  assert.equal(payload.skipped.some((entry) => entry.id === "catalog-free-unknown" && entry.reason === "invalid-shop-item"), true);
  assert.equal(payload.skipped.some((entry) => entry.id === "catalog-unknown-milestone" && entry.reason === "invalid-milestone"), true);
}

async function testUserInventoryPurchaseEndpointUsesServerCatalog() {
  const userId = "inventory-user-purchase-endpoint";
  const shopItem = getTestRotatingShopItem();
  const seedCoins = Math.max(500, shopItem.cost + 50);
  const seeded = await request("POST", "/api/user/inventory/ops", {
    userId,
    ops: [{ id: "purchase-endpoint-seed", type: "coin", delta: seedCoins, reason: "seed" }]
  });
  assert.equal(seeded.response.status, 200, seeded.payload.error);

  const purchased = await request("POST", "/api/user/inventory/purchase", {
    userId,
    type: shopItem.type,
    id: shopItem.id,
    cost: 1,
    purchaseAt: Date.now()
  });
  assert.equal(purchased.response.status, 200, purchased.payload.error);
  assert.equal(purchased.payload.purchase.key, shopItem.key);
  assert.equal(purchased.payload.purchase.cost, shopItem.cost);
  assert.equal(purchased.payload.inventory.coins, seedCoins - shopItem.cost);
  assert.deepEqual(purchased.payload.inventory.cosmetics, [shopItem.key]);

  const duplicate = await request("POST", "/api/user/inventory/purchase", {
    userId,
    type: shopItem.type,
    id: shopItem.id,
    purchaseAt: Date.now()
  });
  assert.equal(duplicate.response.status, 200, duplicate.payload.error);
  assert.equal(duplicate.payload.inventory.coins, seedCoins - shopItem.cost);

  const invalid = await request("POST", "/api/user/inventory/purchase", {
    userId,
    type: "font",
    id: "not-real"
  });
  assert.equal(invalid.response.status, 400);

  const hiddenKey = [...testShopCatalog.keys()].find((key) => !getTestRotatingShopKeys().includes(key));
  const [hiddenType, hiddenId] = hiddenKey.split(":");
  const hidden = await request("POST", "/api/user/inventory/purchase", {
    userId,
    type: hiddenType,
    id: hiddenId,
    purchaseAt: Date.now()
  });
  assert.equal(hidden.response.status, 409);
  assert.equal(hidden.payload.purchase.reason, "shop-rotation-locked");

  const insufficient = await request("POST", "/api/user/inventory/purchase", {
    userId: "inventory-user-purchase-endpoint-empty",
    type: shopItem.type,
    id: shopItem.id,
    purchaseAt: Date.now()
  });
  assert.equal(insufficient.response.status, 409);
  assert.equal(insufficient.payload.purchase.reason, "insufficient-coins");
  assert.equal(insufficient.payload.inventory.coins, 0);
}

async function testUserInventoryMilestoneEndpointUsesServerRewards() {
  const userId = "inventory-user-milestone-endpoint";
  const claimed = await request("POST", "/api/user/inventory/milestone", {
    userId,
    milestoneId: "achievements-10",
    coinDelta: 999999
  });
  assert.equal(claimed.response.status, 200, claimed.payload.error);
  assert.equal(claimed.payload.milestone.coins, 200);
  assert.equal(claimed.payload.inventory.coins, 200);
  assert.deepEqual(claimed.payload.inventory.claimedMilestones, ["achievements-10"]);

  const duplicate = await request("POST", "/api/user/inventory/milestone", {
    userId,
    milestoneId: "achievements-10"
  });
  assert.equal(duplicate.response.status, 200, duplicate.payload.error);
  assert.equal(duplicate.payload.inventory.coins, 200);

  const invalid = await request("POST", "/api/user/inventory/milestone", {
    userId,
    milestoneId: "achievements-999"
  });
  assert.equal(invalid.response.status, 400);
}

async function testAuthenticatedInventoryUsesTokenUser() {
  const previousMode = process.env.INVENTORY_AUTH_MODE;
  process.env.INVENTORY_AUTH_MODE = "warn";
  try {
    const result = await request("POST", "/api/user/inventory/ops", {
      userId: "spoofed-inventory-user",
      ops: [{ id: "auth-coin-start", type: "coin", delta: 77, reason: "auth-test" }]
    }, authHeaders("auth-inventory-user"));
    assert.equal(result.response.status, 200, result.payload.error);
    assert.equal(result.payload.authenticated, true);
    assert.equal(result.payload.inventory.userId, "auth-inventory-user");
    assert.equal(result.payload.inventory.coins, 77);
    assert.equal(result.payload.warnings.includes("inventory-user-id-overridden-by-auth"), true);

    const spoofed = await request("GET", "/api/user/inventory?userId=spoofed-inventory-user");
    assert.equal(spoofed.response.status, 200, spoofed.payload.error);
    assert.equal(spoofed.payload.inventory.coins, 0);
  } finally {
    if (previousMode === undefined) {
      delete process.env.INVENTORY_AUTH_MODE;
    } else {
      process.env.INVENTORY_AUTH_MODE = previousMode;
    }
  }
}

async function testInventoryEnforceModeTightensLegacyEconomyOps() {
  const previousMode = process.env.INVENTORY_AUTH_MODE;
  process.env.INVENTORY_AUTH_MODE = "enforce";
  try {
    const userId = "enforce-economy-user";
    const seeded = await request("POST", "/api/user/inventory/ops", {
      userId,
      ops: [{ id: "enforce-economy-seed", type: "coin", delta: 300 }]
    }, authHeaders(userId));
    assert.equal(seeded.response.status, 200, seeded.payload.error);
    assert.equal(seeded.payload.inventory.coins, 300);

    const legacy = await request("POST", "/api/user/inventory/ops", {
      userId,
      ops: [
        { id: "enforce-legacy-purchase", type: "purchase-cosmetic", key: "font:techno", cost: 1 },
        { id: "enforce-legacy-milestone", type: "milestone", milestoneId: "achievements-10", coinDelta: 999999 }
      ]
    }, authHeaders(userId));
    assert.equal(legacy.response.status, 200, legacy.payload.error);
    assert.equal(legacy.payload.inventory.coins, 300);
    assert.deepEqual(legacy.payload.inventory.cosmetics, []);
    assert.deepEqual(legacy.payload.inventory.claimedMilestones, []);
    assert.equal(legacy.payload.skipped.some((entry) => entry.id === "enforce-legacy-purchase" && entry.reason === "use-purchase-endpoint"), true);
    assert.equal(legacy.payload.skipped.some((entry) => entry.id === "enforce-legacy-milestone" && entry.reason === "use-milestone-endpoint"), true);

    const shopItem = getTestRotatingShopItem();
    const purchase = await request("POST", "/api/user/inventory/purchase", {
      userId,
      type: shopItem.type,
      id: shopItem.id,
      purchaseAt: Date.now()
    }, authHeaders(userId));
    assert.equal(purchase.response.status, 200, purchase.payload.error);
    assert.equal(purchase.payload.inventory.coins, 300 - shopItem.cost);
    assert.deepEqual(purchase.payload.inventory.cosmetics, [shopItem.key]);
  } finally {
    if (previousMode === undefined) {
      delete process.env.INVENTORY_AUTH_MODE;
    } else {
      process.env.INVENTORY_AUTH_MODE = previousMode;
    }
  }
}

async function testInventoryEnforceModeRequiresMatchingAuth() {
  const previousMode = process.env.INVENTORY_AUTH_MODE;
  process.env.INVENTORY_AUTH_MODE = "enforce";
  try {
    const missing = await request("POST", "/api/user/inventory/ops", {
      userId: "enforce-user",
      ops: [{ id: "enforce-missing", type: "coin", delta: 1 }]
    });
    assert.equal(missing.response.status, 401);

    const mismatch = await request("POST", "/api/user/inventory/ops", {
      userId: "other-user",
      ops: [{ id: "enforce-mismatch", type: "coin", delta: 1 }]
    }, authHeaders("enforce-user"));
    assert.equal(mismatch.response.status, 403);

    const ok = await request("POST", "/api/user/inventory/ops", {
      userId: "enforce-user",
      ops: [{ id: "enforce-ok", type: "coin", delta: 5 }]
    }, authHeaders("enforce-user"));
    assert.equal(ok.response.status, 200, ok.payload.error);
    assert.equal(ok.payload.authenticated, true);
    assert.equal(ok.payload.inventory.userId, "enforce-user");
    assert.equal(ok.payload.inventory.coins, 5);
  } finally {
    if (previousMode === undefined) {
      delete process.env.INVENTORY_AUTH_MODE;
    } else {
      process.env.INVENTORY_AUTH_MODE = previousMode;
    }
  }
}

async function testQuestionSubmissionEnforceModeUsesAuthenticatedCreator() {
  const previousMode = process.env.QUESTION_SUBMISSION_AUTH_MODE;
  process.env.QUESTION_SUBMISSION_AUTH_MODE = "enforce";
  try {
    const unauthenticated = await request("POST", "/api/question-submissions", {
      question: makeQuestion("secure-submission-unauthenticated"),
      creator: { id: "secure-creator", name: "Creator" }
    });
    assert.equal(unauthenticated.response.status, 401);

    const spoofed = await request("POST", "/api/question-submissions", {
      question: makeQuestion("secure-submission-spoofed"),
      creator: { id: "spoofed-creator", name: "Creator" }
    }, authHeaders("real-creator"));
    assert.equal(spoofed.response.status, 403);

    const created = await request("POST", "/api/question-submissions", {
      question: makeQuestion("secure-submission-real"),
      creator: { id: "real-creator", name: "Creator" }
    }, authHeaders("real-creator"));
    assert.equal(created.response.status, 201, created.payload.error);
    assert.equal(created.payload.authenticated, true);

    const listed = await request("GET", "/api/question-submissions?creatorId=real-creator", undefined, authHeaders("real-creator"));
    assert.equal(listed.response.status, 200, listed.payload.error);
    assert.equal(listed.payload.submissions.some((submission) => submission.id === created.payload.submission.id), true);
  } finally {
    if (previousMode === undefined) {
      delete process.env.QUESTION_SUBMISSION_AUTH_MODE;
    } else {
      process.env.QUESTION_SUBMISSION_AUTH_MODE = previousMode;
    }
  }
}

async function testDebugQuestionCreateUsesBackendStorage() {
  const question = makeQuestion("science-backend-create-test", {
    gradingStrictness: "strict"
  });
  const { response, payload } = await request("POST", "/api/debug/questions", question, adminHeaders());
  assert.equal(response.status, 201, payload.error);
  assert.equal(payload.question.id, question.id);
  assert.equal(payload.question.gradingStrictness, "strict");
  assert.equal(payload.storage, "backend");
  assert.equal(payload.fileSaved, false);

  const questions = await getDebugQuestions();
  const saved = questions.find((entry) => entry.id === question.id);
  assert.ok(saved);
  assert.equal(saved.question, question.question);
  assert.equal(saved.gradingStrictness, "strict");
}

async function testDebugQuestionUpdateUsesBackendStorage() {
  const original = makeQuestion("science-backend-update-test");
  const created = await request("POST", "/api/debug/questions", original, adminHeaders());
  assert.equal(created.response.status, 201, created.payload.error);

  const updated = makeQuestion("science-backend-update-renamed-test", {
    question: "What updated question is stored in backend storage?",
    canonicalAnswer: "Updated",
    acceptedAnswers: ["updated"]
  });
  const { response, payload } = await request("PUT", `/api/debug/questions/${original.id}`, updated, adminHeaders());
  assert.equal(response.status, 200, payload.error);
  assert.equal(payload.question.id, updated.id);
  assert.equal(payload.storage, "backend");

  const questions = await getDebugQuestions();
  assert.equal(questions.some((entry) => entry.id === original.id), false);
  const saved = questions.find((entry) => entry.id === updated.id);
  assert.ok(saved);
  assert.equal(saved.canonicalAnswer, "Updated");
}

async function testDebugQuestionDeleteUsesBackendStorage() {
  const question = makeQuestion("science-backend-delete-test");
  const created = await request("POST", "/api/debug/questions", question, adminHeaders());
  assert.equal(created.response.status, 201, created.payload.error);

  const { response, payload } = await request("DELETE", `/api/debug/questions/${question.id}`, undefined, adminHeaders());
  assert.equal(response.status, 200, payload.error);
  assert.equal(payload.question.id, question.id);
  assert.equal(payload.storage, "backend");

  const questions = await getDebugQuestions();
  assert.equal(questions.some((entry) => entry.id === question.id), false);
}

async function testRoundUsesLocalGraderWithoutApiKey() {
  const previousAiKey = process.env.AI_API_KEY;
  const previousComputingerKey = process.env.COMPUTINGER_API_KEY;
  const previousOpenAiKey = process.env.OPENAI_API_KEY;
  delete process.env.AI_API_KEY;
  delete process.env.COMPUTINGER_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    const { response, payload } = await request("POST", "/api/round", {
      answer: "Answer",
      blackCard: "What is the test answer?",
      triviaTheme: "Science",
      canonicalAnswer: "Answer",
      acceptedAnswers: ["answer"],
      botCards: ["Wrong"],
      botLabels: ["Bot"],
      mode: "bots",
      roundSeed: "local-grader-no-key"
    });
    assert.equal(response.status, 200, payload.error);
    assert.deepEqual(payload.cards, ["Answer", "Wrong"]);
    assert.deepEqual(payload.correctIndexes, [0]);
  } finally {
    if (previousAiKey === undefined) delete process.env.AI_API_KEY;
    else process.env.AI_API_KEY = previousAiKey;
    if (previousComputingerKey === undefined) delete process.env.COMPUTINGER_API_KEY;
    else process.env.COMPUTINGER_API_KEY = previousComputingerKey;
    if (previousOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousOpenAiKey;
  }
}

async function testRoundAiSecondOpinionReviewsNearMissesTogether() {
  const previousFetch = global.fetch;
  const previousAiKey = process.env.AI_API_KEY;
  const previousAiBaseUrl = process.env.AI_BASE_URL;
  const previousAiStyle = process.env.AI_API_STYLE;
  process.env.AI_API_KEY = "test-ai-key";
  process.env.AI_BASE_URL = "https://ai.test/v1";
  process.env.AI_API_STYLE = "chat";
  let fetchCalls = 0;
  global.fetch = async (url, options = {}) => {
    fetchCalls += 1;
    assert.equal(url, "https://ai.test/v1/chat/completions");
    const body = JSON.parse(options.body || "{}");
    const prompt = JSON.parse(body.messages[1].content);
    if (fetchCalls === 1) {
      assert.deepEqual(prompt.candidateAnswers.map((entry) => entry.index), [0]);
      assert.equal(prompt.candidateAnswers[0].answer, "vinsnt");
      assert.equal(prompt.task.includes("same context-aware acceptance standard"), true);
      assert.equal(prompt.rules.some((rule) => rule.includes("same acceptance standard as the full AI grader")), true);
      assert.equal(prompt.rules.some((rule) => rule.includes("Do not be stricter just because the local preset grader rejected")), true);
    } else {
      assert.deepEqual(prompt.candidateAnswers.map((entry) => entry.index), [0]);
      assert.equal(prompt.trivia.question, "Who drew Sunflowers?");
      assert.equal(prompt.candidateAnswers[0].answer, "van gogh");
    }
    return {
      ok: true,
      async json() {
        return {
          choices: [
            {
              message: {
                content: JSON.stringify({ correctIndexes: [0] })
              }
            }
          ]
        };
      }
    };
  };

  try {
    const rescued = await request("POST", "/api/round", {
      answer: "vinsnt",
      blackCard: "Which artist painted The Starry Night?",
      triviaTheme: "Art",
      canonicalAnswer: "Vincent van Gogh",
      acceptedAnswers: ["van Gogh"],
      botCards: ["vinsnt van gohg", "zzzzzz"],
      botLabels: ["Near Miss Bot", "Gibberish Bot"],
      mode: "bots",
      roundSeed: "ai-second-opinion-near-miss"
    });
    assert.equal(rescued.response.status, 200, rescued.payload.error);
    assert.equal(fetchCalls, 1);
    assert.deepEqual(rescued.payload.correctIndexes, [0]);
    assert.deepEqual(rescued.payload.aiReviewedIndexes, [0]);
    assert.deepEqual(rescued.payload.aiSecondOpinionIndexes, [0]);
    assert.equal(rescued.payload.source, "local-with-ai-second-opinion");

    const contextRescued = await request("POST", "/api/round", {
      answer: "van gogh",
      blackCard: "Who drew Sunflowers?",
      triviaTheme: "Art",
      canonicalAnswer: "vicent",
      acceptedAnswers: ["vicent"],
      botCards: ["cat"],
      botLabels: ["Bot"],
      mode: "bots",
      roundSeed: "ai-second-opinion-context"
    });
    assert.equal(contextRescued.response.status, 200, contextRescued.payload.error);
    assert.equal(fetchCalls, 2);
    assert.deepEqual(contextRescued.payload.correctIndexes, [0]);
    assert.deepEqual(contextRescued.payload.aiReviewedIndexes, [0]);
    assert.deepEqual(contextRescued.payload.aiSecondOpinionIndexes, [0]);
    assert.equal(contextRescued.payload.source, "local-with-ai-second-opinion");

    const lowSignalCases = [
      {
        answer: "zzzzzz",
        blackCard: "Which artist painted The Starry Night?",
        triviaTheme: "Art",
        canonicalAnswer: "Vincent van Gogh",
        acceptedAnswers: ["van Gogh"],
        roundSeed: "ai-second-opinion-repeated-gibberish"
      },
      {
        answer: "qwrtypsdf",
        blackCard: "Who painted Sunflowers?",
        triviaTheme: "Art",
        canonicalAnswer: "Vincent van Gogh",
        acceptedAnswers: ["van Gogh"],
        roundSeed: "ai-second-opinion-skipped-keyboard-walk"
      },
      {
        answer: "poiu ytrewq",
        blackCard: "Which organelle is often called the powerhouse of the cell?",
        triviaTheme: "Science",
        canonicalAnswer: "Mitochondria",
        acceptedAnswers: ["Mitochondria"],
        roundSeed: "ai-second-opinion-reversed-keyboard-walk"
      },
      {
        answer: "ababababab",
        blackCard: "What process lets plants convert sunlight into chemical energy?",
        triviaTheme: "Science",
        canonicalAnswer: "Photosynthesis",
        acceptedAnswers: ["Photosynthesis"],
        roundSeed: "ai-second-opinion-repeated-nonsense-chunk"
      },
      {
        answer: "fjkjqxfskj",
        blackCard: "What is the highest mountain above sea level?",
        triviaTheme: "Geography",
        canonicalAnswer: "Mount Everest",
        acceptedAnswers: ["Everest"],
        roundSeed: "ai-second-opinion-rare-letter-mash"
      },
      {
        answer: "yegeygayegayfe",
        blackCard: "Which glowing weapon does a Jedi usually use?",
        triviaTheme: "Film and TV",
        canonicalAnswer: "Lightsaber",
        acceptedAnswers: ["Lightsaber"],
        roundSeed: "ai-second-opinion-fake-syllable-mash"
      },
      {
        answer: "blorblorblorf",
        blackCard: "Which organelle is often called the powerhouse of the cell?",
        triviaTheme: "Science",
        canonicalAnswer: "Mitochondria",
        acceptedAnswers: ["Mitochondria"],
        roundSeed: "ai-second-opinion-near-repeated-fake-word"
      },
      {
        answer: "efabhebahbaehebahebahbeahbeahbeahbeahbeahbeahbeahbeaheabhaehbea",
        blackCard: "Which glowing weapon does a Jedi usually use?",
        triviaTheme: "Film and TV",
        canonicalAnswer: "Lightsaber",
        acceptedAnswers: ["Lightsaber"],
        roundSeed: "ai-second-opinion-long-repeated-low-variety"
      }
    ];
    for (const lowSignalCase of lowSignalCases) {
      const lowSignal = await request("POST", "/api/round", {
        ...lowSignalCase,
        botCards: ["cat"],
        botLabels: ["Bot"],
        mode: "bots"
      });
      assert.equal(lowSignal.response.status, 200, lowSignal.payload.error);
      assert.equal(fetchCalls, 2);
      assert.deepEqual(lowSignal.payload.correctIndexes, []);
      assert.deepEqual(lowSignal.payload.aiReviewedIndexes, []);
      assert.deepEqual(lowSignal.payload.aiSecondOpinionIndexes, []);
    }

    const rejected = await request("POST", "/api/round", {
      answer: "Unicorn",
      blackCard: "Which glowing weapon does a Jedi usually use?",
      triviaTheme: "Film and TV",
      canonicalAnswer: "Lightsaber",
      acceptedAnswers: ["Lightsaber"],
      rejectedAnswers: ["Unicorn"],
      botCards: ["cat"],
      botLabels: ["Bot"],
      mode: "bots",
      roundSeed: "ai-second-opinion-rejected-preset"
    });
    assert.equal(rejected.response.status, 200, rejected.payload.error);
    assert.equal(fetchCalls, 2);
    assert.deepEqual(rejected.payload.correctIndexes, []);
    assert.deepEqual(rejected.payload.aiReviewedIndexes, []);
    assert.deepEqual(rejected.payload.aiSecondOpinionIndexes, []);
  } finally {
    global.fetch = previousFetch;
    if (previousAiKey === undefined) delete process.env.AI_API_KEY;
    else process.env.AI_API_KEY = previousAiKey;
    if (previousAiBaseUrl === undefined) delete process.env.AI_BASE_URL;
    else process.env.AI_BASE_URL = previousAiBaseUrl;
    if (previousAiStyle === undefined) delete process.env.AI_API_STYLE;
    else process.env.AI_API_STYLE = previousAiStyle;
  }
}

async function testRoundDebugLocalModeSkipsAiOverride() {
  const previousFetch = global.fetch;
  const previousAiKey = process.env.AI_API_KEY;
  const previousAiBaseUrl = process.env.AI_BASE_URL;
  const previousAiStyle = process.env.AI_API_STYLE;
  process.env.AI_API_KEY = "test-ai-key";
  process.env.AI_BASE_URL = "https://ai.test/v1";
  process.env.AI_API_STYLE = "chat";
  let fetchCalls = 0;
  global.fetch = async () => {
    fetchCalls += 1;
    throw new Error("local debug grading should not call AI");
  };

  try {
    const { response, payload } = await request("POST", "/api/round", {
      answer: "van gogh",
      blackCard: "Who drew Sunflowers?",
      triviaTheme: "Art",
      canonicalAnswer: "vicent",
      acceptedAnswers: ["vicent"],
      botCards: ["cat"],
      botLabels: ["Bot"],
      mode: "bots",
      gradingMode: "local",
      roundSeed: "debug-local-only"
    }, adminHeaders());
    assert.equal(response.status, 200, payload.error);
    assert.equal(fetchCalls, 0);
    assert.deepEqual(payload.correctIndexes, []);
    assert.equal(payload.source, "local-fallback");
    assert.equal(payload.gradingMode, "local");
  } finally {
    global.fetch = previousFetch;
    if (previousAiKey === undefined) delete process.env.AI_API_KEY;
    else process.env.AI_API_KEY = previousAiKey;
    if (previousAiBaseUrl === undefined) delete process.env.AI_BASE_URL;
    else process.env.AI_BASE_URL = previousAiBaseUrl;
    if (previousAiStyle === undefined) delete process.env.AI_API_STYLE;
    else process.env.AI_API_STYLE = previousAiStyle;
  }
}

async function testDebugAiShieldExplainsMixedGradingGate() {
  const previousFetch = global.fetch;
  const previousAiKey = process.env.AI_API_KEY;
  process.env.AI_API_KEY = "test-ai-key";
  let fetchCalls = 0;
  global.fetch = async () => {
    fetchCalls += 1;
    throw new Error("AI shield tests must not call AI");
  };

  const basePayload = {
    blackCard: "Who drew Sunflowers?",
    triviaTheme: "Art",
    canonicalAnswer: "vicent",
    acceptedAnswers: ["vicent"],
    rejectedAnswers: [],
    botCards: ["cat"],
    botLabels: ["Bot"],
    mode: "bots",
    gradingStrictness: "normal"
  };

  try {
    const unauthenticated = await request("POST", "/api/debug/ai-shield", {
      ...basePayload,
      answer: "van gogh"
    });
    assert.equal(unauthenticated.response.status, 401, unauthenticated.payload.error);

    const contextAllowed = await request("POST", "/api/debug/ai-shield", {
      ...basePayload,
      answer: "van gogh"
    }, adminHeaders());
    assert.equal(contextAllowed.response.status, 200, contextAllowed.payload.error);
    assert.equal(contextAllowed.payload.wouldAskAi, true);
    assert.equal(contextAllowed.payload.shield, "allows-ai-review");
    assert.equal(contextAllowed.payload.reasonCode, "context-signal");
    assert.equal(contextAllowed.payload.aiConfigured, true);

    const keyboardBlocked = await request("POST", "/api/debug/ai-shield", {
      ...basePayload,
      answer: "qwrtypsdf"
    }, adminHeaders());
    assert.equal(keyboardBlocked.response.status, 200, keyboardBlocked.payload.error);
    assert.equal(keyboardBlocked.payload.wouldAskAi, false);
    assert.equal(keyboardBlocked.payload.reasonCode, "keyboard-mash");

    const fakeSyllableBlocked = await request("POST", "/api/debug/ai-shield", {
      ...basePayload,
      canonicalAnswer: "Lightsaber",
      acceptedAnswers: ["Lightsaber"],
      answer: "yegeygayegayfe"
    }, adminHeaders());
    assert.equal(fakeSyllableBlocked.response.status, 200, fakeSyllableBlocked.payload.error);
    assert.equal(fakeSyllableBlocked.payload.wouldAskAi, false);
    assert.equal(fakeSyllableBlocked.payload.reasonCode, "repetitive-nonsense");

    const longLoopBlocked = await request("POST", "/api/debug/ai-shield", {
      ...basePayload,
      canonicalAnswer: "Lightsaber",
      acceptedAnswers: ["Lightsaber"],
      answer: "efabhebahbaehebahebahbeahbeahbeahbeahbeahbeahbeahbeaheabhaehbea"
    }, adminHeaders());
    assert.equal(longLoopBlocked.response.status, 200, longLoopBlocked.payload.error);
    assert.equal(longLoopBlocked.payload.wouldAskAi, false);
    assert.equal(longLoopBlocked.payload.reasonCode, "repetitive-nonsense");

    const rejectedBlocked = await request("POST", "/api/debug/ai-shield", {
      ...basePayload,
      canonicalAnswer: "Lightsaber",
      acceptedAnswers: ["Lightsaber"],
      rejectedAnswers: ["Unicorn"],
      answer: "Unicorn"
    }, adminHeaders());
    assert.equal(rejectedBlocked.response.status, 200, rejectedBlocked.payload.error);
    assert.equal(rejectedBlocked.payload.wouldAskAi, false);
    assert.equal(rejectedBlocked.payload.reasonCode, "rejected-answer");
    assert.equal(rejectedBlocked.payload.explicitlyRejected, true);

    const botBlocked = await request("POST", "/api/debug/ai-shield", {
      ...basePayload,
      answer: "van gogh",
      treatAsBot: true
    }, adminHeaders());
    assert.equal(botBlocked.response.status, 200, botBlocked.payload.error);
    assert.equal(botBlocked.payload.wouldAskAi, false);
    assert.equal(botBlocked.payload.reasonCode, "bot-answer");
    assert.equal(botBlocked.payload.treatAsBot, true);

    const localBlocked = await request("POST", "/api/debug/ai-shield", {
      ...basePayload,
      canonicalAnswer: "Vincent van Gogh",
      acceptedAnswers: ["van Gogh"],
      answer: "Vincent van Gogh"
    }, adminHeaders());
    assert.equal(localBlocked.response.status, 200, localBlocked.payload.error);
    assert.equal(localBlocked.payload.wouldAskAi, false);
    assert.equal(localBlocked.payload.reasonCode, "local-accepted");
    assert.equal(localBlocked.payload.localCorrect, true);
    assert.equal(fetchCalls, 0);
  } finally {
    global.fetch = previousFetch;
    if (previousAiKey === undefined) delete process.env.AI_API_KEY;
    else process.env.AI_API_KEY = previousAiKey;
  }
}

async function testRoundDebugForceAiUsesModelOverride() {
  const previousFetch = global.fetch;
  const previousAiKey = process.env.AI_API_KEY;
  const previousAiBaseUrl = process.env.AI_BASE_URL;
  const previousAiStyle = process.env.AI_API_STYLE;
  process.env.AI_API_KEY = "test-ai-key";
  process.env.AI_BASE_URL = "https://ai.test/v1";
  process.env.AI_API_STYLE = "chat";
  let fetchCalls = 0;
  global.fetch = async (url, options = {}) => {
    fetchCalls += 1;
    assert.equal(url, "https://ai.test/v1/chat/completions");
    const body = JSON.parse(options.body || "{}");
    const prompt = JSON.parse(body.messages[1].content);
    assert.equal(prompt.trivia.question, "Who drew Debug Sunflowers?");
    assert.equal(prompt.submittedAnswers[0].answer, "van gogh");
    return {
      ok: true,
      async json() {
        return {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  cards: ["van gogh", "cat"],
                  winnerIndex: 0,
                  correctIndexes: [0]
                })
              }
            }
          ]
        };
      }
    };
  };

  try {
    const { response, payload } = await request("POST", "/api/round", {
      answer: "van gogh",
      blackCard: "Who drew Debug Sunflowers?",
      triviaTheme: "Art",
      canonicalAnswer: "vicent",
      acceptedAnswers: ["vicent"],
      botCards: ["cat"],
      botLabels: ["Bot"],
      mode: "bots",
      gradingMode: "force-ai",
      roundSeed: "debug-force-ai"
    }, adminHeaders());
    assert.equal(response.status, 200, payload.error);
    assert.equal(fetchCalls, 1);
    assert.deepEqual(payload.correctIndexes, [0]);
    assert.deepEqual(payload.aiReviewedIndexes, [0, 1]);
    assert.deepEqual(payload.aiSecondOpinionIndexes, []);
    assert.equal(payload.source, "model");
    assert.equal(payload.gradingMode, "force-ai");
  } finally {
    global.fetch = previousFetch;
    if (previousAiKey === undefined) delete process.env.AI_API_KEY;
    else process.env.AI_API_KEY = previousAiKey;
    if (previousAiBaseUrl === undefined) delete process.env.AI_BASE_URL;
    else process.env.AI_BASE_URL = previousAiBaseUrl;
    if (previousAiStyle === undefined) delete process.env.AI_API_STYLE;
    else process.env.AI_API_STYLE = previousAiStyle;
  }
}

async function testRoundDebugForceAiRequiresAdmin() {
  const previousFetch = global.fetch;
  const previousAiKey = process.env.AI_API_KEY;
  process.env.AI_API_KEY = "test-ai-key";
  let fetchCalls = 0;
  global.fetch = async () => {
    fetchCalls += 1;
    throw new Error("unauthenticated force AI should not call AI");
  };

  try {
    const { response, payload } = await request("POST", "/api/round", {
      answer: "van gogh",
      blackCard: "Who drew Locked Debug Sunflowers?",
      triviaTheme: "Art",
      canonicalAnswer: "vicent",
      acceptedAnswers: ["vicent"],
      botCards: ["cat"],
      botLabels: ["Bot"],
      mode: "bots",
      gradingMode: "force-ai",
      roundSeed: "debug-force-ai-no-admin"
    });
    assert.equal(response.status, 403, payload.error);
    assert.equal(payload.error, "Admin authentication is required for grading debug modes.");
    assert.equal(fetchCalls, 0);
  } finally {
    global.fetch = previousFetch;
    if (previousAiKey === undefined) delete process.env.AI_API_KEY;
    else process.env.AI_API_KEY = previousAiKey;
  }
}

async function main() {
  testClientUsesRoomCommandEndpointsForMultiplayerWrites();
  await testSupabaseConfigEndpoint();
  await testDirectRoomLookupIncludesCompleteRooms();
  await testHostLeaveDeletesRoom();
  await testBrowserExitRemovesJoinedPlayer();
  await testBrowserExitDeletesRoomWhenNoRealPlayersRemain();
  await testRoomListClosesStoredRoomsWithoutActivePlayersAfterGrace();
  await testRoomListClosesStaleSinglePlayerRoomAfterGrace();
  await testRoomListUsesParticipantsWhenActiveCountIsMissing();
  await testRoomDirectoryAcceptsProfileImagePayload();
  await testRoomDirectoryPreservesProfileStyleFields();
  await testPrivateRoomPasswordIsRedactedAndServerValidated();
  await testPrivateToggleWithoutPasswordRemainsPublic();
  await testHostCookieRequiredForPrivilegedRoomActions();
  await testParticipantCookieRequiredForRoomActions();
  await testRoomAnswersAreRedactedFromPublicFetches();
  await testStaticSensitiveFilesAreForbidden();
  await testImageProxyRejectsPrivateHosts();
  await testSecurityHeadersAreApplied();
  await testAdminLoginRateLimit();
  await testHostPageExitDeletesRoom();
  await testManualHostLeaveTransfersOwnershipAndAuthority();
  await testPromotedHostLeavingClosesRoomWhenNoPlayersRemain();
  await testHostReconnectTimeoutPromotesOldestPlayer();
  await testCreatingSecondRoomTransfersOlderRoomHost();
  await testAnswerSurvivesReconnectCommand();
  await testLateJoinerReceivesRoundState();
  await testRoomChatPreservesMessageIds();
  await testCompactRoomDeltasAvoidFullRoomPayloads();
  await testCompactPresenceCanIncludeAuthoritativeRoomSnapshot();
  await testRoomCommandRejoinReclaimsSameTabActiveParticipant();
  await testRoomCommandRejectsDuplicateActiveParticipantTab();
  await testRoomCommandRejoinRestoresDisconnectedSubmittedParticipant();
  await testRoomCommandHostRejoinPreservesActiveMatchState();
  await testRoomCommandLobbyRejoinPreservesPlayerSlot();
  await testRoomCommandRejoinRestoresWaitingParticipantDuringAnswerPhase();
  await testRoomCommandRejoinRestoresSubmittedParticipantDuringGrading();
  await testSpectatorPresenceDoesNotConsumePlayerSlot();
  await testSpectatorLeaveUpdatesAuthoritativeRoomSnapshot();
  await testParticipantWithoutActiveDefaultsActiveAndRole();
  await testSpectatorCannotSubmitGameplayAnswer();
  await testDuplicateHostPresenceRemovesStaleHostRow();
  await testRoomSettingsPatchPreservesParticipantsChatAndGame();
  await testRoomSettingsClassicModeNormalization();
  await testRoomPowerStateEndpointStampsEvents();
  await testAdminRoomPowerDebugRequiresAdminAndPublishesCanonicalPowerState();
  await testEveryAvailablePowerUsesCanonicalMultiplayerTransport();
  await testRoomPowerStateRejectsPowerMissingFromAuthoritativeHand();
  await testRoomPowerStateRejectsInvalidTargetParticipant();
  await testRoomPowerStateTimeBenderUpdatesSharedTimers();
  await testServerPowerEngineDerivesActionStateAndIsIdempotent();
  await testServerPowerEngineDerivesScoreStealFromStoredPlayers();
  await testServerPowerEngineCalculatesChaosVariantSeparately();
  await testServerPowerEngineHardResetUsesStoredStreakProtections();
  await testStaleRoomRoundResultCannotOverwriteRematch();
  await testStaleRoomGameEndCannotCompleteRematch();
  await testRoomReturnToLobbyClearsMatchState();
  await testStaleParticipantSubmissionCannotOverwriteRematch();
  await testStaleParticipantSubmissionCannotOverwriteCurrentRound();
  await testCurrentRoundSubmissionIsAnswerEvent();
  await testRoomAnswerEndpointStoresRoundScopedAnswer();
  await testRoomAnswerEndpointRejectsStaleRoundAndTimedOutState();
  await testRoomAnswerEndpointStartsGradingWhenAllSubmitted();
  await testHostSubmittedBotAnswerCanStartGrading();
  await testHostLastAfterSubmittedBotsStartsGrading();
  await testHostSubmissionAutoSubmitsBotsAndStartsGrading();
  await testBotOnlyRoomSkipAutoSubmitsBotsAndStartsGrading();
  await testPresenceSubmissionCanStartGradingWhenAllSubmitted();
  await testResolveAllSubmittedCommandStartsGradingFromAuthoritativeAnswers();
  await testDisconnectedParticipantStatusDoesNotBlockGrading();
  await testSimultaneousRoomSubmissionsStartSingleGradingTransition();
  await testDuplicateRoomAnswerCanCompleteStuckAllSubmittedRound();
  await testRoomRoundAdvancingEndpointStampsEvent();
  await testRoomCommandClientEventIdIsIdempotent();
  await testDuplicateRoomCommandRepublishesPersistedEvents();
  await testRoomStartMatchPreservesInitialPowerState();
  await testRoomRoundSetupEndpointCreatesSharedSetup();
  await testRoomRoundSetupRecoversMissingPreparationState();
  await testRoomRoundSetupCannotSkipPreparedRound();
  await testRoomUsesStoredHostQuestionLanguage();
  await testStaleRoomRoundAdvancingCannotOverwriteCurrentRound();
  await testDelayedRoomRoundAdvancingCannotClearStartedSetup();
  await testStaleRoomSetupCannotOverwriteGrading();
  await testRematchDoesNotReusePreviousPowerState();
  await testRematchRoundSetupCanStartAfterCompleteMatch();
  await testStaleRoomRoundResultCannotOverwriteCurrentRound();
  await testStaleRoomRoundSkipCannotOverwriteCurrentRound();
  await testStaleRoomPowerStateCannotOverwriteCurrentRound();
  await testFutureRoomPowerStateCannotOverwriteCurrentRound();
  await testRoomPowerStateDeltaPreservesStoredFullState();
  await testRoomPowerStateIgnoresStaleHandEntries();
  await testStaleRoomPowerStateCannotOverwriteRematchHands();
  await testRoomPowerStateCanClearPlayedHistory();
  await testSpectatorCannotUpdateRoomPowerState();
  await testRoomRoundSkipEndpointStampsEvent();
  await testRoomGradingAllSubmittedDoesNotForcePendingAnswers();
  await testRoomGradingAllSubmittedLocksWhenAllAnswersPresent();
  await testRoomGradingAllSubmittedAcceptsForcedBotSubmission();
  await testRoomRoundResultRequiresGradingLock();
  await testRoomModerationEndpointMutesAndBans();
  await testKickedParticipantCanRejoinWithSameProfile();
  await testBannedParticipantProfileCannotRejoinWithNewId();
  await testRoomPresenceRejectsBotWhenRoomFull();
  await testRoomModerationEndpointKicksBot();
  await testRapidRoomBotAddsAreSerializedAndUnique();
  await testRequestedRoomBotIdCanBeKicked();
  await testModerationCommandUsesTargetParticipantId();
  await testJoinedRoomParticipantIdCanBeModerated();
  await testHostCloseEndpointDeletesRoom();
  await testAdminClosePublishesAuthoritativeRoomClosedEvent();
  await testUserInventoryOpsAreIdempotent();
  await testUserInventoryCoinReconcilePersistsExitBalance();
  await testUserInventoryPurchaseAndUnlockRowsPersist();
  await testUserInventoryEconomyValuesUseServerCatalog();
  await testUserInventoryPurchaseEndpointUsesServerCatalog();
  await testUserInventoryMilestoneEndpointUsesServerRewards();
  await testAuthenticatedInventoryUsesTokenUser();
  await testInventoryEnforceModeTightensLegacyEconomyOps();
  await testInventoryEnforceModeRequiresMatchingAuth();
  await testQuestionSubmissionEnforceModeUsesAuthenticatedCreator();
  await testDebugQuestionCreateUsesBackendStorage();
  await testDebugQuestionUpdateUsesBackendStorage();
  await testDebugQuestionDeleteUsesBackendStorage();
  await testRoundUsesLocalGraderWithoutApiKey();
  await testRoundAiSecondOpinionReviewsNearMissesTogether();
  await testRoundDebugLocalModeSkipsAiOverride();
  await testDebugAiShieldExplainsMixedGradingGate();
  await testRoundDebugForceAiUsesModelOverride();
  await testRoundDebugForceAiRequiresAdmin();
  console.log("Room integration tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
