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

  const chat = await request("POST", `/api/rooms/${code}/chat`, {
    compact: true,
    message: {
      id: "chat-compact-message-1",
      sender: "Host",
      owner: "player",
      participantId: "host-client",
      text: "Compact hello",
      createdAt: Date.now()
    }
  });
  assert.equal(chat.response.status, 200, chat.payload.error);
  assert.equal(chat.payload.message.id, "chat-compact-message-1");
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
  assert.deepEqual(powerState.hands.find((entry) => entry.participantId === "host-client").hand, ["shuffle"]);
  assert.deepEqual(powerState.hands.find((entry) => entry.participantId === "guest-client").hand, ["xray_hacks"]);
  assert.equal(powerState.players.find((entry) => entry.participantId === "guest-client").score, 0);
  assert.equal(powerState.players.find((entry) => entry.participantId === "host-client").score, 100);
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
  assert.equal(stored.payload.room.events.some((event) => event.type === "round_skipped"), true);
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

  const stored = await getRoom(code);
  assert.equal(stored.response.status, 200, stored.payload.error);
  assert.equal(stored.payload.room.participants.some((participant) => participant.id === "guest-client"), false);
  assert.equal(stored.payload.room.events.some((event) => event.type === "participant_moderated"), true);
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
  const { response, payload } = await request("POST", "/api/user/inventory/ops", {
    userId,
    ops: [
      { id: "purchase-seed-coins", type: "coin", delta: 300, reason: "seed" },
      { id: "purchase-techno-font", type: "purchase-cosmetic", key: "font:techno", cost: 100 },
      { id: "unlock-first-blood", type: "achievement", achievementId: "first-blood", record: { source: "test" } },
      { id: "progress-room-regular", type: "achievement-progress", key: "publicMatchesFinished", value: 10, mode: "set" },
      { id: "milestone-five", type: "milestone", milestoneId: "achievements-5", coinDelta: 100 },
      {
        id: "profile-prefix",
        type: "profile",
        profile: {
          equippedAchievementId: "first-blood",
          cardCustomization: { fontId: "techno", titleColourId: "rarity" }
        }
      }
    ]
  });
  assert.equal(response.status, 200, payload.error);
  assert.equal(payload.inventory.coins, 300);
  assert.deepEqual(payload.inventory.cosmetics, ["font:techno"]);
  assert.ok(payload.inventory.achievements["first-blood"]);
  assert.equal(payload.inventory.achievementProgress.publicMatchesFinished, 10);
  assert.deepEqual(payload.inventory.claimedMilestones, ["achievements-5"]);
  assert.equal(payload.inventory.profile.equippedAchievementId, "first-blood");
  assert.equal(payload.inventory.profile.cardCustomization.fontId, "techno");

  const duplicate = await request("POST", "/api/user/inventory/ops", {
    userId,
    ops: [
      { id: "purchase-techno-font", type: "purchase-cosmetic", key: "font:techno", cost: 100 },
      { id: "milestone-five", type: "milestone", milestoneId: "achievements-5", coinDelta: 50 }
    ]
  });
  assert.equal(duplicate.response.status, 200, duplicate.payload.error);
  assert.equal(duplicate.payload.inventory.coins, 300);
  assert.deepEqual(duplicate.payload.inventory.cosmetics, ["font:techno"]);
}

async function testUserInventoryEconomyValuesUseServerCatalog() {
  const userId = "inventory-user-economy-catalog";
  const { response, payload } = await request("POST", "/api/user/inventory/ops", {
    userId,
    ops: [
      { id: "catalog-seed-coins", type: "coin", delta: 300, reason: "seed" },
      { id: "catalog-cheap-techno", type: "purchase-cosmetic", key: "font:techno", cost: 1 },
      { id: "catalog-free-unknown", type: "purchase-cosmetic", key: "font:not-real", cost: 0 },
      { id: "catalog-inflated-milestone", type: "milestone", milestoneId: "achievements-10", coinDelta: 999999 },
      { id: "catalog-unknown-milestone", type: "milestone", milestoneId: "achievements-999", coinDelta: 1000 }
    ]
  });
  assert.equal(response.status, 200, payload.error);
  assert.equal(payload.inventory.coins, 400);
  assert.deepEqual(payload.inventory.cosmetics, ["font:techno"]);
  assert.deepEqual(payload.inventory.claimedMilestones, ["achievements-10"]);
  assert.equal(payload.skipped.some((entry) => entry.id === "catalog-free-unknown" && entry.reason === "invalid-shop-item"), true);
  assert.equal(payload.skipped.some((entry) => entry.id === "catalog-unknown-milestone" && entry.reason === "invalid-milestone"), true);
}

async function testUserInventoryPurchaseEndpointUsesServerCatalog() {
  const userId = "inventory-user-purchase-endpoint";
  const seeded = await request("POST", "/api/user/inventory/ops", {
    userId,
    ops: [{ id: "purchase-endpoint-seed", type: "coin", delta: 150, reason: "seed" }]
  });
  assert.equal(seeded.response.status, 200, seeded.payload.error);

  const purchased = await request("POST", "/api/user/inventory/purchase", {
    userId,
    type: "font",
    id: "techno",
    cost: 1
  });
  assert.equal(purchased.response.status, 200, purchased.payload.error);
  assert.equal(purchased.payload.purchase.key, "font:techno");
  assert.equal(purchased.payload.purchase.cost, 100);
  assert.equal(purchased.payload.inventory.coins, 50);
  assert.deepEqual(purchased.payload.inventory.cosmetics, ["font:techno"]);

  const duplicate = await request("POST", "/api/user/inventory/purchase", {
    userId,
    type: "font",
    id: "techno"
  });
  assert.equal(duplicate.response.status, 200, duplicate.payload.error);
  assert.equal(duplicate.payload.inventory.coins, 50);

  const invalid = await request("POST", "/api/user/inventory/purchase", {
    userId,
    type: "font",
    id: "not-real"
  });
  assert.equal(invalid.response.status, 400);

  const insufficient = await request("POST", "/api/user/inventory/purchase", {
    userId: "inventory-user-purchase-endpoint-empty",
    type: "pattern",
    id: "carbon"
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

    const purchase = await request("POST", "/api/user/inventory/purchase", {
      userId,
      type: "font",
      id: "techno"
    }, authHeaders(userId));
    assert.equal(purchase.response.status, 200, purchase.payload.error);
    assert.equal(purchase.payload.inventory.coins, 200);
    assert.deepEqual(purchase.payload.inventory.cosmetics, ["font:techno"]);
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
  await testSpectatorPresenceDoesNotConsumePlayerSlot();
  await testDuplicateHostPresenceRemovesStaleHostRow();
  await testRoomSettingsPatchPreservesParticipantsChatAndGame();
  await testRoomPowerStateEndpointStampsEvents();
  await testStaleRoomRoundResultCannotOverwriteRematch();
  await testStaleRoomGameEndCannotCompleteRematch();
  await testStaleParticipantSubmissionCannotOverwriteRematch();
  await testRoomPowerStateDeltaPreservesStoredFullState();
  await testRoomPowerStateIgnoresStaleHandEntries();
  await testStaleRoomPowerStateCannotOverwriteRematchHands();
  await testRoomPowerStateCanClearPlayedHistory();
  await testRoomRoundSkipEndpointStampsEvent();
  await testRoomModerationEndpointMutesAndBans();
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
