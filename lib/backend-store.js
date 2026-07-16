const roomPrefix = "cards-against-ai:room:";
const roomClosePrefix = "cards-against-ai:room-close:";
const questionOverridePrefix = "cards-against-ai:question-override:";
const submissionPrefix = "cards-against-ai:question-submission:";

function createBackendStore(options = {}) {
  const ttlSeconds = createRoomTtlConfig(options);
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
  const questionOverrides = new Map();
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
    roomTtlSeconds: ttlSeconds,
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
        expiresAt: Date.now() + getRoomTtlSeconds(storedRoom, ttlSeconds) * 1000
      });
      return storedRoom;
    },
    async upsertRoomClose(close) {
      const normalizedCode = normalizeRoomCode(close.code);
      const storedClose = { ...close, code: normalizedCode, closedAt: Date.now() };
      roomCloses.set(normalizedCode, {
        close: storedClose,
        expiresAt: Date.now() + ttlSeconds.closed * 1000
      });
      return storedClose;
    },
    async deleteRoom(code) {
      return rooms.delete(normalizeRoomCode(code));
    },
    async listQuestionOverrides() {
      return [...questionOverrides.values()];
    },
    async getQuestionOverride(id) {
      return questionOverrides.get(normalizeQuestionId(id)) || null;
    },
    async upsertQuestionOverride(override) {
      const id = normalizeQuestionId(override.id);
      const storedOverride = { ...override, id, updatedAt: Date.now() };
      questionOverrides.set(id, storedOverride);
      return storedOverride;
    },
    async deleteQuestionOverride(id) {
      return questionOverrides.delete(normalizeQuestionId(id));
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
    roomTtlSeconds: ttlSeconds,
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
      await command(["SET", roomKey(normalizedCode), JSON.stringify(storedRoom), "EX", String(getRoomTtlSeconds(storedRoom, ttlSeconds))]);
      return storedRoom;
    },
    async upsertRoomClose(close) {
      const normalizedCode = normalizeRoomCode(close.code);
      const storedClose = { ...close, code: normalizedCode, closedAt: Date.now() };
      await command(["SET", roomCloseKey(normalizedCode), JSON.stringify(storedClose), "EX", String(ttlSeconds.closed)]);
      return storedClose;
    },
    async deleteRoom(code) {
      const deleted = await command(["DEL", roomKey(code)]);
      return Number(deleted) > 0;
    },
    async listQuestionOverrides() {
      const keys = await command(["KEYS", `${questionOverridePrefix}*`]);
      if (!Array.isArray(keys) || !keys.length) {
        return [];
      }
      const values = await Promise.all(keys.map((key) => command(["GET", key])));
      return values.map(parseStoredRoom).filter(Boolean);
    },
    async getQuestionOverride(id) {
      return parseStoredRoom(await command(["GET", questionOverrideKey(id)]));
    },
    async upsertQuestionOverride(override) {
      const id = normalizeQuestionId(override.id);
      const storedOverride = { ...override, id, updatedAt: Date.now() };
      await command(["SET", questionOverrideKey(id), JSON.stringify(storedOverride)]);
      return storedOverride;
    },
    async deleteQuestionOverride(id) {
      const deleted = await command(["DEL", questionOverrideKey(id)]);
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

function createRoomTtlConfig(options = {}) {
  const fallback = normalizeTtlSeconds(options.roomTtlSeconds, 60 * 60 * 6);
  return {
    lobby: normalizeTtlSeconds(options.lobbyRoomTtlSeconds, 5 * 60),
    active: normalizeTtlSeconds(options.activeRoomTtlSeconds, 2 * 60 * 60),
    closed: normalizeTtlSeconds(options.closedRoomTtlSeconds, 60),
    fallback
  };
}

function normalizeTtlSeconds(value, fallback) {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : fallback;
}

function getRoomTtlSeconds(room, ttlSeconds) {
  const status = String(room?.status || "").toLowerCase();
  if (status === "in-progress" || status === "active") {
    return ttlSeconds.active;
  }
  if (status === "complete" || status === "closed") {
    return ttlSeconds.closed;
  }
  if (status === "lobby" || status === "draft" || !status) {
    return ttlSeconds.lobby;
  }
  return ttlSeconds.fallback;
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

function questionOverrideKey(id) {
  return `${questionOverridePrefix}${normalizeQuestionId(id)}`;
}

function normalizeRoomCode(code) {
  return String(code || "").trim().toUpperCase();
}

function normalizeQuestionId(id) {
  return String(id || "").trim().slice(0, 160);
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
