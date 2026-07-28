const assert = require("node:assert/strict");
const { createHmac } = require("node:crypto");
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

async function upsertRoom(room) {
  const { response, payload } = await request("PUT", "/api/rooms", { room });
  assert.equal(response.status, 200, payload.error);
  assert.ok(payload.room.revision >= 1);
  return payload.room;
}

async function listRooms() {
  const { response, payload } = await request("GET", "/api/rooms");
  assert.equal(response.status, 200, payload.error);
  return payload.rooms;
}

async function getRoom(code) {
  return request("GET", `/api/rooms/${code}`);
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
  const { response, payload } = await request("POST", `/api/rooms/${code}/leave`, {
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

  const { response, payload } = await request("POST", `/api/rooms/${code}/leave`, {
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

  const { response, payload } = await request("POST", `/api/rooms/${code}/leave`, {
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

async function testRoomListShowsStoredRoomsWithoutActivePlayers() {
  const code = makeCode(8107);
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
  assert.equal(rooms.some((room) => room.code === code), true);
  const { response, payload } = await getRoom(code);
  assert.equal(response.status, 200, payload.error);
  assert.equal(payload.room.code, code);
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

  const wrongPassword = await request("POST", `/api/rooms/${code}/presence`, {
    participant: {
      id: "private-guest-wrong",
      name: "Guest",
      active: true,
      status: "joined"
    },
    password: "wrong"
  }, { cookie: "" });
  assert.equal(wrongPassword.response.status, 403);

  const correctPassword = await request("POST", `/api/rooms/${code}/presence`, {
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

  const settingsUpdate = await request("PATCH", `/api/rooms/${code}/settings`, {
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

async function testHostCookieRequiredForPrivilegedRoomActions() {
  const code = makeCode(8121);
  await upsertRoom(makeRoom(code));

  const forgedClose = await request("POST", `/api/rooms/${code}/close`, {
    participantId: "host-client",
    reason: "forged"
  }, { cookie: "" });
  assert.equal(forgedClose.response.status, 403);

  const forgedHostPresence = await request("POST", `/api/rooms/${code}/presence`, {
    participant: {
      id: "attacker-client",
      name: "Attacker",
      host: true,
      active: true,
      status: "host"
    }
  }, { cookie: "" });
  assert.equal(forgedHostPresence.response.status, 403);

  const realClose = await request("POST", `/api/rooms/${code}/close`, {
    participantId: "host-client",
    reason: "manual"
  });
  assert.equal(realClose.response.status, 200, realClose.payload.error);
  assert.equal(realClose.payload.closed, true);
}

async function testParticipantCookieRequiredForRoomActions() {
  const code = makeCode(8122);
  await upsertRoom(makeRoom(code));
  const join = await request("POST", `/api/rooms/${code}/presence`, {
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

  const forgedPresence = await request("POST", `/api/rooms/${code}/presence`, {
    compact: true,
    participant: {
      id: "secure-guest",
      name: "Attacker",
      active: true,
      status: "submitted",
      answer: "Forged"
    }
  }, { cookie: "" });
  assert.equal(forgedPresence.response.status, 403);

  const forgedChat = await request("POST", `/api/rooms/${code}/chat`, {
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

  const realChat = await request("POST", `/api/rooms/${code}/chat`, {
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

  const forgedPower = await request("POST", `/api/rooms/${code}/power-state`, {
    round: 1,
    powerId: "xray_hacks",
    actorParticipantId: "secure-guest",
    hands: []
  }, { cookie: "" });
  assert.equal(forgedPower.response.status, 403);

  const forgedLeave = await request("POST", `/api/rooms/${code}/leave`, {
    participantId: "secure-guest",
    reason: "forged"
  }, { cookie: "" });
  assert.equal(forgedLeave.response.status, 403);

  const realLeave = await request("POST", `/api/rooms/${code}/leave`, {
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
  const { response, payload } = await request("POST", `/api/rooms/${code}/leave`, {
    participantId: "host-client",
    reason: "page-exit"
  });
  assert.equal(response.status, 200, payload.error);
  assert.equal(payload.closed, true);
  assert.equal(payload.reason, "host-left");
  const rooms = await listRooms();
  assert.equal(rooms.some((entry) => entry.code === code), false);
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

  const { response, payload } = await request("PUT", "/api/rooms", {
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

async function testAnswerSurvivesHeartbeat() {
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

  const { response, payload } = await request("POST", `/api/rooms/${code}/heartbeat`, {
    participantId: "host-client",
    status: "playing"
  });
  assert.equal(response.status, 200, payload.error);
  const host = payload.room.participants.find((participant) => participant.id === "host-client");
  assert.equal(host.answer, "Paris");
  assert.equal(host.submittedRound, 1);
  assert.equal(host.remainingTime, 12);
}

async function testLateJoinerReceivesRoundState() {
  const code = makeCode(8104);
  await upsertRoom(makeRoom(code));
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
  const gameUpdate = await request("PUT", `/api/rooms/${code}/game`, { game });
  assert.equal(gameUpdate.response.status, 200, gameUpdate.payload.error);

  const presence = await request("POST", `/api/rooms/${code}/presence`, {
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
  assert.ok(presence.payload.room.revision >= 3);
  assert.ok(presence.payload.room.events.some((event) => event.type === "round_started"));
}

async function testRoomChatPreservesMessageIds() {
  const code = makeCode(8109);
  await upsertRoom(makeRoom(code));

  const { response, payload } = await request("POST", `/api/rooms/${code}/chat`, {
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
  const chat = await request("POST", `/api/rooms/${code}/chat`, {
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
  assert.equal(chat.payload.message.revision, chat.payload.revision);
  assert.ok(chat.payload.message.createdAt >= chatStartedAt);
  assert.equal(chat.payload.room, undefined);
  assert.ok(chat.payload.revision >= 2);

  const presence = await request("POST", `/api/rooms/${code}/presence`, {
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

  const presence = await request("POST", `/api/rooms/${code}/presence`, {
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

async function testSpectatorPresenceDoesNotConsumePlayerSlot() {
  const code = makeCode(8111);
  await upsertRoom(makeRoom(code));

  const { response, payload } = await request("POST", `/api/rooms/${code}/presence`, {
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

  const leave = await request("POST", `/api/rooms/${code}/leave`, {
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

  const { response, payload } = await request("POST", `/api/rooms/${code}/presence`, {
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

  const join = await request("POST", `/api/rooms/${code}/presence`, {
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

  const submit = await request("POST", `/api/rooms/${code}/presence`, {
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

  const { response, payload } = await request("POST", `/api/rooms/${code}/presence`, {
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
  await upsertRoom(makeRoom(code));
  await request("POST", `/api/rooms/${code}/chat`, {
    message: {
      id: "settings-preserve-chat",
      sender: "Host",
      owner: "player",
      participantId: "host-client",
      text: "Preserve me",
      createdAt: Date.now()
    }
  });
  await request("POST", `/api/rooms/${code}/presence`, {
    participant: {
      id: "settings-joiner",
      name: "Joiner",
      active: true,
      status: "joined"
    }
  });
  await request("PUT", `/api/rooms/${code}/game`, {
    game: {
      matchId: `${code}-match`,
      status: "playing",
      round: 1,
      setup: makeSetup(1),
      updatedAt: Date.now()
    }
  });

  const { response, payload } = await request("PATCH", `/api/rooms/${code}/settings`, {
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
  assert.ok(payload.revision >= 5);

  const stored = await getRoom(code);
  assert.equal(stored.response.status, 200, stored.payload.error);
  assert.equal(stored.payload.room.settings.timerSeconds, 45);
  assert.equal(stored.payload.room.settings.autoAdvance, false);
  assert.equal(stored.payload.room.chat.some((message) => message.id === "settings-preserve-chat"), true);
  assert.equal(stored.payload.room.participants.some((participant) => participant.id === "settings-joiner"), true);
  assert.equal(stored.payload.room.game.setup.blackCard, "Round 1 question?");
  assert.equal(stored.payload.room.events.some((event) => event.type === "settings_updated"), true);
}

async function testRoomPowerStateEndpointStampsEvents() {
  const code = makeCode(8113);
  await upsertRoom(makeRoom(code, { status: "in-progress", game: { matchId: `${code}-match`, status: "playing", round: 1, setup: makeSetup(1), updatedAt: Date.now() } }));
  const { response, payload } = await request("POST", `/api/rooms/${code}/power-state`, {
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
  assert.equal(events.payload.events.some((event) => event.type === "power_state"), true);
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

  const { response, payload } = await request("POST", `/api/rooms/${code}/power-state`, {
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

  const stale = await request("POST", `/api/rooms/${code}/round-result`, {
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

  const stale = await request("PUT", `/api/rooms/${code}/game`, {
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

  const returned = await request("POST", `/api/rooms/${code}/lobby`, {
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

  const stale = await request("POST", `/api/rooms/${code}/presence`, {
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
  assert.equal(stale.response.status, 200, stale.payload.error);

  const stored = await getRoom(code);
  assert.equal(stored.response.status, 200, stored.payload.error);
  const host = stored.payload.room.participants.find((participant) => participant.id === "host-client");
  assert.equal(host.answer, "Current answer");
  assert.equal(host.submittedRound, 1);
  assert.equal(host.submissionMatchId, `${code}-new-match`);
  assert.equal(host.remainingTime, 20);

  const missingMatchId = await request("POST", `/api/rooms/${code}/presence`, {
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
  assert.equal(missingMatchId.response.status, 200, missingMatchId.payload.error);

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

  const stale = await request("POST", `/api/rooms/${code}/presence`, {
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
  assert.equal(stale.response.status, 200, stale.payload.error);
  assert.equal(stale.payload.eventType, "participant-updated");

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
    game: {
      matchId,
      status: "playing",
      round: 2,
      setup: makeSetup(2),
      updatedAt: Date.now()
    }
  }));

  const submitted = await request("POST", `/api/rooms/${code}/presence`, {
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

  const submitted = await request("POST", `/api/rooms/${code}/answer`, {
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

  const duplicate = await request("POST", `/api/rooms/${code}/answer`, {
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

  const stale = await request("POST", `/api/rooms/${code}/answer`, {
    participantId: "host-client",
    matchId,
    round: 2,
    answer: "Old answer",
    remainingTime: 4
  });
  assert.equal(stale.response.status, 409);

  const timedOut = await request("POST", `/api/rooms/${code}/answer`, {
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

  const first = await request("POST", `/api/rooms/${code}/answer`, {
    participantId: "host-client",
    matchId,
    round: 2,
    answer: "Host answer",
    remainingTime: 12
  });
  assert.equal(first.response.status, 200, first.payload.error);
  assert.equal(first.payload.grading, undefined);

  const second = await request("POST", `/api/rooms/${code}/answer`, {
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

  const stored = await getRoom(code);
  assert.equal(stored.response.status, 200, stored.payload.error);
  assert.equal(stored.payload.room.game.status, "grading");
  assert.equal(stored.payload.room.game.answers["host-client"].answer, "Host answer");
  assert.equal(stored.payload.room.game.answers["guest-client"].answer, "Guest answer");
  assert.equal(stored.payload.room.events.some((event) => event.type === "round_grading"), true);
}

async function testDuplicateRoomAnswerCanCompleteStuckAllSubmittedRound() {
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

  const duplicate = await request("POST", `/api/rooms/${code}/answer`, {
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
  await upsertRoom(makeRoom(code));

  const { response, payload } = await request("POST", `/api/rooms/${code}/round-advancing`, {
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
  assert.equal(payload.eventType, "round-advancing");
  assert.equal(payload.matchId, matchId);
  assert.equal(payload.round, 1);
  assert.equal(payload.game.status, "starting");
  assert.equal(payload.game.setup, null);
  assert.ok(payload.game.setupStartedAt > 0);
  assert.equal(payload.matchSettings.chaos, true);
  assert.equal(payload.matchSettings.autoAdvance, false);
  assert.ok(payload.revision >= 2);

  const stored = await getRoom(code);
  assert.equal(stored.response.status, 200, stored.payload.error);
  assert.equal(stored.payload.room.status, "in-progress");
  assert.equal(stored.payload.room.game.matchId, matchId);
  assert.equal(stored.payload.room.game.round, 1);
  assert.equal(stored.payload.room.game.status, "starting");
  assert.ok(stored.payload.room.game.setupStartedAt > 0);
  assert.equal(stored.payload.room.settings.chaos, true);
  assert.equal(stored.payload.room.settings.randomModifiers, false);
  assert.equal(stored.payload.room.events.some((event) => event.type === "round_advancing"), true);
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

  const { response, payload } = await request("POST", `/api/rooms/${code}/round-setup`, {
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

  const { response, payload } = await request("POST", `/api/rooms/${code}/round-setup`, {
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

  const skipped = await request("POST", `/api/rooms/${code}/round-setup`, {
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

  const stale = await request("POST", `/api/rooms/${code}/round-advancing`, {
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
    game: {
      matchId,
      status: "playing",
      round: 1,
      setup: makeSetup(1),
      updatedAt: Date.now()
    }
  }));

  const delayed = await request("POST", `/api/rooms/${code}/round-advancing`, {
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

  const stale = await request("PUT", `/api/rooms/${code}/game`, {
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
    game: {
      matchId: `${code}-old-match`,
      status: "ended",
      round: 10,
      setup: makeSetup(10),
      updatedAt: Date.now()
    }
  }));

  const { response, payload } = await request("PUT", `/api/rooms/${code}/game`, {
    hostParticipantId: "host-client",
    game: {
      matchId: `${code}-new-match`,
      status: "playing",
      round: 1,
      setup: makeSetup(1),
      updatedAt: Date.now()
    }
  });
  assert.equal(response.status, 200, payload.error);
  assert.equal(payload.room.status, "in-progress");
  assert.equal(payload.room.game.matchId, `${code}-new-match`);
  assert.equal(payload.room.game.round, 1);
  assert.equal(payload.room.game.setup.blackCard, "Round 1 question?");
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

  const stale = await request("POST", `/api/rooms/${code}/round-result`, {
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

  const stale = await request("POST", `/api/rooms/${code}/round-skip`, {
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

  const stale = await request("POST", `/api/rooms/${code}/power-state`, {
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
          { participantId: "host-client", owner: "player", hand: ["software_downgrade"], fresh: [] },
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

  const { response, payload } = await request("POST", `/api/rooms/${code}/power-state`, {
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

  const { response, payload } = await request("POST", `/api/rooms/${code}/power-state`, {
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

  const stale = await request("POST", `/api/rooms/${code}/power-state`, {
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

  const { response, payload } = await request("POST", `/api/rooms/${code}/power-state`, {
    round: 2,
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
  const presence = await request("POST", `/api/rooms/${code}/presence`, {
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
  const response = await request("POST", `/api/rooms/${code}/power-state`, {
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

  const { response, payload } = await request("POST", `/api/rooms/${code}/round-skip`, {
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

  const earlyResult = await request("POST", `/api/rooms/${code}/round-result`, {
    hostParticipantId: "host-client",
    roundResult: makeRoundResult(2, { matchId })
  });
  assert.equal(earlyResult.response.status, 409);

  const grading = await request("POST", `/api/rooms/${code}/grading`, {
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

  const lockedResult = await request("POST", `/api/rooms/${code}/round-result`, {
    hostParticipantId: "host-client",
    roundResult: makeRoundResult(2, {
      matchId,
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
  assert.equal(lockedResult.payload.roundResult.resultSummary.judgements[0].reason, "That matched the answer cleanly.");
  assert.equal(lockedResult.payload.roundResult.resultSummary.scoreDeltas[0].delta, 1200);
  assert.equal(lockedResult.payload.roundResult.resultSummary.leaderboard[0].rank, 1);

  const stored = await getRoom(code);
  assert.equal(stored.response.status, 200, stored.payload.error);
  assert.equal(stored.payload.room.game.status, "grading");
  assert.equal(stored.payload.room.game.roundResult.questionId, "test-question-2");
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

  const mute = await request("POST", `/api/rooms/${code}/moderation`, {
    hostParticipantId: "host-client",
    participantId: "guest-client",
    action: "mute"
  });
  assert.equal(mute.response.status, 200, mute.payload.error);
  assert.equal(mute.payload.participant.muted, true);

  const ban = await request("POST", `/api/rooms/${code}/moderation`, {
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

  const kick = await request("POST", `/api/rooms/${code}/moderation`, {
    hostParticipantId: "host-client",
    participantId: "kickable-client",
    action: "kick"
  });
  assert.equal(kick.response.status, 200, kick.payload.error);
  assert.equal(kick.payload.participant.active, false);
  assert.equal(kick.payload.participant.status, "kicked");

  const rejoin = await request("POST", `/api/rooms/${code}/presence`, {
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

  const ban = await request("POST", `/api/rooms/${code}/moderation`, {
    hostParticipantId: "host-client",
    participantId: "banned-client",
    action: "ban"
  });
  assert.equal(ban.response.status, 200, ban.payload.error);
  assert.equal(ban.payload.banned.includes("guest:banned-profile"), true);

  const rejoin = await request("POST", `/api/rooms/${code}/presence`, {
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

  const added = await request("POST", `/api/rooms/${code}/presence`, {
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

  const { response, payload } = await request("POST", `/api/rooms/${code}/moderation`, {
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

  const added = await request("POST", `/api/rooms/${code}/presence`, {
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
  assert.equal(added.response.status, 200, added.payload.error);
  assert.equal(added.payload.participant.id, "bot-client-2");
  assert.equal(added.payload.participant.bot, true);

  const storedAfterAdd = await getRoom(code);
  assert.equal(storedAfterAdd.response.status, 200, storedAfterAdd.payload.error);
  assert.equal(storedAfterAdd.payload.room.participants.some((participant) => participant.id === "bot-client"), false);
  assert.equal(storedAfterAdd.payload.room.participants.some((participant) => participant.id === "bot-client-2"), true);
  assert.equal(storedAfterAdd.payload.room.activePlayers, 2);
}

async function testHostCloseEndpointDeletesRoom() {
  const code = makeCode(8115);
  await upsertRoom(makeRoom(code));
  const { response, payload } = await request("POST", `/api/rooms/${code}/close`, {
    participantId: "host-client",
    reason: "manual"
  });
  assert.equal(response.status, 200, payload.error);
  assert.equal(payload.closed, true);
  assert.equal(payload.reason, "manual");
  const directRoom = await getRoom(code);
  assert.equal(directRoom.response.status, 410);
  assert.equal(directRoom.payload.close.reason, "manual");
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
    assert.deepEqual(prompt.candidateAnswers.map((entry) => entry.index), [0, 1]);
    return {
      ok: true,
      async json() {
        return {
          choices: [
            {
              message: {
                content: JSON.stringify({ correctIndexes: [0, 1] })
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
    assert.deepEqual(rescued.payload.correctIndexes, [0, 1]);
    assert.deepEqual(rescued.payload.aiReviewedIndexes, [0, 1]);
    assert.deepEqual(rescued.payload.aiSecondOpinionIndexes, [0, 1]);
    assert.equal(rescued.payload.source, "local-with-ai-second-opinion");

    const gibberish = await request("POST", "/api/round", {
      answer: "zzzzzz",
      blackCard: "Which artist painted The Starry Night?",
      triviaTheme: "Art",
      canonicalAnswer: "Vincent van Gogh",
      acceptedAnswers: ["van Gogh"],
      botCards: ["Claude Monet"],
      botLabels: ["Bot"],
      mode: "bots",
      roundSeed: "ai-second-opinion-gibberish"
    });
    assert.equal(gibberish.response.status, 200, gibberish.payload.error);
    assert.equal(fetchCalls, 1);
    assert.deepEqual(gibberish.payload.correctIndexes, []);
    assert.deepEqual(gibberish.payload.aiReviewedIndexes, []);
    assert.deepEqual(gibberish.payload.aiSecondOpinionIndexes, []);
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

async function main() {
  await testSupabaseConfigEndpoint();
  await testDirectRoomLookupIncludesCompleteRooms();
  await testHostLeaveDeletesRoom();
  await testBrowserExitRemovesJoinedPlayer();
  await testBrowserExitDeletesRoomWhenNoRealPlayersRemain();
  await testRoomListShowsStoredRoomsWithoutActivePlayers();
  await testRoomListUsesParticipantsWhenActiveCountIsMissing();
  await testRoomDirectoryAcceptsProfileImagePayload();
  await testRoomDirectoryPreservesProfileStyleFields();
  await testPrivateRoomPasswordIsRedactedAndServerValidated();
  await testHostCookieRequiredForPrivilegedRoomActions();
  await testParticipantCookieRequiredForRoomActions();
  await testRoomAnswersAreRedactedFromPublicFetches();
  await testStaticSensitiveFilesAreForbidden();
  await testImageProxyRejectsPrivateHosts();
  await testSecurityHeadersAreApplied();
  await testAdminLoginRateLimit();
  await testHostPageExitDeletesRoom();
  await testHostReconnectTimeoutPromotesOldestPlayer();
  await testCreatingSecondRoomTransfersOlderRoomHost();
  await testAnswerSurvivesHeartbeat();
  await testLateJoinerReceivesRoundState();
  await testRoomChatPreservesMessageIds();
  await testCompactRoomDeltasAvoidFullRoomPayloads();
  await testCompactPresenceCanIncludeAuthoritativeRoomSnapshot();
  await testSpectatorPresenceDoesNotConsumePlayerSlot();
  await testSpectatorLeaveUpdatesAuthoritativeRoomSnapshot();
  await testParticipantWithoutActiveDefaultsActiveAndRole();
  await testSpectatorCannotSubmitGameplayAnswer();
  await testDuplicateHostPresenceRemovesStaleHostRow();
  await testRoomSettingsPatchPreservesParticipantsChatAndGame();
  await testRoomPowerStateEndpointStampsEvents();
  await testRoomPowerStateTimeBenderUpdatesSharedTimers();
  await testStaleRoomRoundResultCannotOverwriteRematch();
  await testStaleRoomGameEndCannotCompleteRematch();
  await testRoomReturnToLobbyClearsMatchState();
  await testStaleParticipantSubmissionCannotOverwriteRematch();
  await testStaleParticipantSubmissionCannotOverwriteCurrentRound();
  await testCurrentRoundSubmissionIsAnswerEvent();
  await testRoomAnswerEndpointStoresRoundScopedAnswer();
  await testRoomAnswerEndpointRejectsStaleRoundAndTimedOutState();
  await testRoomAnswerEndpointStartsGradingWhenAllSubmitted();
  await testDuplicateRoomAnswerCanCompleteStuckAllSubmittedRound();
  await testRoomRoundAdvancingEndpointStampsEvent();
  await testRoomRoundSetupEndpointCreatesSharedSetup();
  await testRoomRoundSetupRecoversMissingPreparationState();
  await testRoomRoundSetupCannotSkipPreparedRound();
  await testStaleRoomRoundAdvancingCannotOverwriteCurrentRound();
  await testDelayedRoomRoundAdvancingCannotClearStartedSetup();
  await testStaleRoomSetupCannotOverwriteGrading();
  await testRematchRoundSetupCanStartAfterCompleteMatch();
  await testStaleRoomRoundResultCannotOverwriteCurrentRound();
  await testStaleRoomRoundSkipCannotOverwriteCurrentRound();
  await testStaleRoomPowerStateCannotOverwriteCurrentRound();
  await testRoomPowerStateDeltaPreservesStoredFullState();
  await testRoomPowerStateIgnoresStaleHandEntries();
  await testStaleRoomPowerStateCannotOverwriteRematchHands();
  await testRoomPowerStateCanClearPlayedHistory();
  await testSpectatorCannotUpdateRoomPowerState();
  await testRoomRoundSkipEndpointStampsEvent();
  await testRoomRoundResultRequiresGradingLock();
  await testRoomModerationEndpointMutesAndBans();
  await testKickedParticipantCanRejoinWithSameProfile();
  await testBannedParticipantProfileCannotRejoinWithNewId();
  await testRoomPresenceRejectsBotWhenRoomFull();
  await testRoomModerationEndpointKicksBot();
  await testHostCloseEndpointDeletesRoom();
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
  console.log("Room integration tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
