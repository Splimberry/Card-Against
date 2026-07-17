const assert = require("node:assert/strict");
const { Readable } = require("node:stream");

process.env.BACKEND_STORE = "memory";
process.env.ADMIN_TOKEN = "room-test-admin-token";
process.env.QUESTION_FILE_WRITES = "disabled";
process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_ANON_KEY = "test-anon-key";

const handleRequest = require("../server");

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
  req.headers = {
    host: "test.local",
    ...(body === undefined ? {} : { "content-type": "application/json" }),
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

  return {
    response: result.response,
    payload: result.text ? JSON.parse(result.text) : {}
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

async function testRoomSettingsPatchPreservesParticipantsChatAndGame() {
  const code = makeCode(8112);
  await upsertRoom(makeRoom(code));
  await request("POST", `/api/rooms/${code}/chat`, {
    message: {
      id: "settings-preserve-chat",
      sender: "Host",
      owner: "player",
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

async function testDebugQuestionCreateUsesBackendStorage() {
  const question = makeQuestion("science-backend-create-test");
  const { response, payload } = await request("POST", "/api/debug/questions", question, adminHeaders());
  assert.equal(response.status, 201, payload.error);
  assert.equal(payload.question.id, question.id);
  assert.equal(payload.storage, "backend");
  assert.equal(payload.fileSaved, false);

  const questions = await getDebugQuestions();
  const saved = questions.find((entry) => entry.id === question.id);
  assert.ok(saved);
  assert.equal(saved.question, question.question);
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
  await testHostPageExitDeletesRoom();
  await testAnswerSurvivesHeartbeat();
  await testLateJoinerReceivesRoundState();
  await testRoomChatPreservesMessageIds();
  await testCompactRoomDeltasAvoidFullRoomPayloads();
  await testSpectatorPresenceDoesNotConsumePlayerSlot();
  await testRoomSettingsPatchPreservesParticipantsChatAndGame();
  await testRoomPowerStateEndpointStampsEvents();
  await testRoomPowerStateDeltaPreservesStoredFullState();
  await testRoomModerationEndpointMutesAndBans();
  await testHostCloseEndpointDeletesRoom();
  await testDebugQuestionCreateUsesBackendStorage();
  await testDebugQuestionUpdateUsesBackendStorage();
  await testDebugQuestionDeleteUsesBackendStorage();
  console.log("Room integration tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
