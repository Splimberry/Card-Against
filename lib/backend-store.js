const roomPrefix = "cards-against-ai:room:";
const roomClosePrefix = "cards-against-ai:room-close:";
const submissionPrefix = "cards-against-ai:question-submission:";

function createBackendStore(options = {}) {
  const ttlSeconds = Number(options.roomTtlSeconds || 60 * 60 * 6);
  const redisUrl = getRedisRestUrl();
  const redisToken = getRedisRestToken();

  if (process.env.BACKEND_STORE !== "memory" && redisUrl && redisToken) {
    return createRedisStore({ redisUrl, redisToken, ttlSeconds });
  }

  return createMemoryStore({ ttlSeconds });
}

function createMemoryStore({ ttlSeconds }) {
  const rooms = new Map();
  const roomCloses = new Map();
  const submissions = new Map();

  function pruneRooms() {
    const now = Date.now();
    for (const [code, entry] of rooms.entries()) {
      if (entry.expiresAt <= now) {
        rooms.delete(code);
      }
    }
    for (const [code, entry] of roomCloses.entries()) {
      if (entry.expiresAt <= now) {
        roomCloses.delete(code);
      }
    }
  }

  return {
    mode: "memory",
    persistent: false,
    async listRooms() {
      pruneRooms();
      return [...rooms.values()].map((entry) => entry.room);
    },
    async getRoom(code) {
      pruneRooms();
      return rooms.get(normalizeRoomCode(code))?.room || null;
    },
    async getRoomClose(code) {
      pruneRooms();
      return roomCloses.get(normalizeRoomCode(code))?.close || null;
    },
    async upsertRoom(room) {
      const normalizedCode = normalizeRoomCode(room.code);
      const storedRoom = { ...room, code: normalizedCode, updatedAt: Date.now() };
      rooms.set(normalizedCode, {
        room: storedRoom,
        expiresAt: Date.now() + ttlSeconds * 1000
      });
      return storedRoom;
    },
    async upsertRoomClose(close) {
      const normalizedCode = normalizeRoomCode(close.code);
      const storedClose = { ...close, code: normalizedCode, closedAt: Date.now() };
      roomCloses.set(normalizedCode, {
        close: storedClose,
        expiresAt: Date.now() + ttlSeconds * 1000
      });
      return storedClose;
    },
    async deleteRoom(code) {
      return rooms.delete(normalizeRoomCode(code));
    },
    async listQuestionSubmissions() {
      return [...submissions.values()];
    },
    async getQuestionSubmission(id) {
      return submissions.get(normalizeSubmissionId(id)) || null;
    },
    async upsertQuestionSubmission(submission) {
      const id = normalizeSubmissionId(submission.id);
      const storedSubmission = { ...submission, id, updatedAt: Date.now() };
      submissions.set(id, storedSubmission);
      return storedSubmission;
    },
    async deleteQuestionSubmission(id) {
      return submissions.delete(normalizeSubmissionId(id));
    }
  };
}

function createRedisStore({ redisUrl, redisToken, ttlSeconds }) {
  async function command(args) {
    const response = await fetch(redisUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${redisToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(args)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.error) {
      throw new Error(data.error || `Redis command failed with ${response.status}`);
    }
    return data.result;
  }

  return {
    mode: "redis-rest",
    persistent: true,
    async listRooms() {
      const keys = await command(["KEYS", `${roomPrefix}*`]);
      if (!Array.isArray(keys) || !keys.length) {
        return [];
      }
      const values = await Promise.all(keys.map((key) => command(["GET", key])));
      return values.map(parseStoredRoom).filter(Boolean);
    },
    async getRoom(code) {
      return parseStoredRoom(await command(["GET", roomKey(code)]));
    },
    async getRoomClose(code) {
      return parseStoredRoom(await command(["GET", roomCloseKey(code)]));
    },
    async upsertRoom(room) {
      const normalizedCode = normalizeRoomCode(room.code);
      const storedRoom = { ...room, code: normalizedCode, updatedAt: Date.now() };
      await command(["SET", roomKey(normalizedCode), JSON.stringify(storedRoom), "EX", String(ttlSeconds)]);
      return storedRoom;
    },
    async upsertRoomClose(close) {
      const normalizedCode = normalizeRoomCode(close.code);
      const storedClose = { ...close, code: normalizedCode, closedAt: Date.now() };
      await command(["SET", roomCloseKey(normalizedCode), JSON.stringify(storedClose), "EX", String(ttlSeconds)]);
      return storedClose;
    },
    async deleteRoom(code) {
      const deleted = await command(["DEL", roomKey(code)]);
      return Number(deleted) > 0;
    },
    async listQuestionSubmissions() {
      const keys = await command(["KEYS", `${submissionPrefix}*`]);
      if (!Array.isArray(keys) || !keys.length) {
        return [];
      }
      const values = await Promise.all(keys.map((key) => command(["GET", key])));
      return values.map(parseStoredRoom).filter(Boolean);
    },
    async getQuestionSubmission(id) {
      return parseStoredRoom(await command(["GET", submissionKey(id)]));
    },
    async upsertQuestionSubmission(submission) {
      const id = normalizeSubmissionId(submission.id);
      const storedSubmission = { ...submission, id, updatedAt: Date.now() };
      await command(["SET", submissionKey(id), JSON.stringify(storedSubmission)]);
      return storedSubmission;
    },
    async deleteQuestionSubmission(id) {
      const deleted = await command(["DEL", submissionKey(id)]);
      return Number(deleted) > 0;
    }
  };
}

function parseStoredRoom(value) {
  if (!value) {
    return null;
  }
  try {
    return typeof value === "string" ? JSON.parse(value) : value;
  } catch {
    return null;
  }
}

function roomKey(code) {
  return `${roomPrefix}${normalizeRoomCode(code)}`;
}

function roomCloseKey(code) {
  return `${roomClosePrefix}${normalizeRoomCode(code)}`;
}

function submissionKey(id) {
  return `${submissionPrefix}${normalizeSubmissionId(id)}`;
}

function normalizeRoomCode(code) {
  return String(code || "").trim().toUpperCase();
}

function normalizeSubmissionId(id) {
  return String(id || "").trim().slice(0, 160);
}

function getRedisRestUrl() {
  return process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || "";
}

function getRedisRestToken() {
  return process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || "";
}

module.exports = {
  createBackendStore
};
