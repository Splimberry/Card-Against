const assert = require("node:assert/strict");
const { Readable } = require("node:stream");

process.env.BACKEND_STORE = "memory";

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

async function request(method, path, body) {
  const chunks = body === undefined ? [] : [JSON.stringify(body)];
  const req = Readable.from(chunks);
  req.method = method;
  req.url = path;
  req.headers = {
    host: "test.local",
    ...(body === undefined ? {} : { "content-type": "application/json" })
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

async function testRoomListHidesRoomsWithoutActivePlayers() {
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
  assert.equal(rooms.some((room) => room.code === code), false);
  const { response, payload } = await getRoom(code);
  assert.equal(response.status, 200, payload.error);
  assert.equal(payload.room.code, code);
}

async function testBackgroundTabDoesNotDeleteRoom() {
  const code = makeCode(8102);
  await upsertRoom(makeRoom(code));
  const { response, payload } = await request("POST", `/api/rooms/${code}/leave`, {
    participantId: "host-client",
    reason: "page-exit"
  });
  assert.equal(response.status, 200, payload.error);
  assert.equal(payload.closed, false);
  assert.equal(payload.reason, "page-exit-ignored");
  const rooms = await listRooms();
  const room = rooms.find((entry) => entry.code === code);
  assert.ok(room);
  assert.equal(room.hostExitPendingAt, 0);
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
  assert.ok(presence.payload.room.revision >= 3);
  assert.ok(presence.payload.room.events.some((event) => event.type === "round_started"));
}

async function main() {
  await testDirectRoomLookupIncludesCompleteRooms();
  await testHostLeaveDeletesRoom();
  await testBrowserExitRemovesJoinedPlayer();
  await testBrowserExitDeletesRoomWhenNoRealPlayersRemain();
  await testRoomListHidesRoomsWithoutActivePlayers();
  await testBackgroundTabDoesNotDeleteRoom();
  await testAnswerSurvivesHeartbeat();
  await testLateJoinerReceivesRoundState();
  console.log("Room integration tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
