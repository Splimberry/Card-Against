const { createServer } = require("node:http");
const { readFile, stat, writeFile } = require("node:fs/promises");
const { createReadStream, existsSync, readFileSync } = require("node:fs");
const { extname, join, normalize } = require("node:path");
const { createHmac, randomBytes, timingSafeEqual } = require("node:crypto");
const { lookup } = require("node:dns/promises");
const { isIP } = require("node:net");
const { createGzip } = require("node:zlib");
const { createBackendStore } = require("./lib/backend-store");

const root = __dirname;
loadEnv();
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "127.0.0.1";
const backendStore = createBackendStore({
  roomTtlSeconds: process.env.ROOM_TTL_SECONDS || 60 * 60 * 6,
  lobbyRoomTtlSeconds: process.env.ROOM_LOBBY_TTL_SECONDS || 5 * 60,
  activeRoomTtlSeconds: process.env.ROOM_ACTIVE_TTL_SECONDS || 2 * 60 * 60,
  closedRoomTtlSeconds: process.env.ROOM_CLOSED_TTL_SECONDS || 60
});
const imageCache = new Map();
const imageCacheTtlMs = 15 * 60 * 1000;
const imageCacheMaxEntries = 120;
const imageCacheMaxBytes = 48 * 1024 * 1024;
let imageCacheBytes = 0;
const adminCookieName = "cai_admin_session";
const roomHostCookiePrefix = "cai_room_host_";
const roomParticipantCookiePrefix = "cai_room_participant_";
const adminSessionTtlSeconds = 60 * 60 * 12;
const roomHostSessionTtlSeconds = 60 * 60 * 12;
const roomParticipantSessionTtlSeconds = 60 * 60 * 12;
const maxRoomEvents = 100;
const roomRequestMaxBytes = 750_000;
const hostReconnectGraceMs = 60 * 1000;
const participantReconnectGraceMs = 60 * 1000;
const rateLimitBuckets = new Map();
const chatCooldownBuckets = new Map();
const aiRoundCache = new Map();
const aiRoundCacheTtlMs = 2 * 60 * 1000;
const aiRoundCacheMaxEntries = 250;
const profileShopRotationIntervalMs = 3 * 60 * 60 * 1000;
const profileShopRotationSize = 3;
const profileShopRotationPurchaseGraceMs = 12 * 60 * 60 * 1000;
const inventoryShopCatalog = new Map([
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
const inventoryShopCatalogKeys = [...inventoryShopCatalog.keys()];
const inventoryMilestoneRewards = new Map([
  ["achievements-5", 100],
  ["achievements-10", 200],
  ["achievements-15", 50],
  ["achievements-20", 100],
  ["achievements-25", 100],
  ["achievements-30", 300],
  ["achievements-35", 100],
  ["achievements-40", 100],
  ["achievements-45", 100],
  ["achievements-50", 0],
  ["achievements-55", 100],
  ["achievements-60", 100],
  ["achievements-65", 200],
  ["achievements-70", 0]
]);
const triviaThemes = [
  "Pop Culture",
  "Gaming and Geek Culture",
  "Geo and History",
  "Animals",
  "Food and Drinks",
  "Sports",
  "Internet Culture",
  "Science",
  "Mythology",
  "Art and Music"
];
const gradingStrictnessOptions = ["forgiving", "normal", "strict", "exact"];
const gradingStrictnessSet = new Set(gradingStrictnessOptions);
const questionBank = loadQuestionBank();

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".avif": "image/avif"
};

async function handleRequest(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    if (!checkRateLimit(req, res, url)) {
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/round") {
      await handleRound(req, res);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/setup") {
      await handleSetup(req, res);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/image") {
      await handleImageProxy(url, res);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/auth/session") {
      handleAuthSession(req, res);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/auth/supabase-config") {
      handleSupabaseConfig(res);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/user/inventory") {
      await handleGetUserInventory(req, url, res);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/user/inventory/purchase") {
      await handleUserInventoryPurchase(req, res);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/user/inventory/milestone") {
      await handleUserInventoryMilestone(req, res);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/user/inventory/ops") {
      await handleUserInventoryOps(req, res);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/auth/admin/login") {
      await handleAdminLogin(req, res);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/auth/logout") {
      handleLogout(req, res);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/question-submissions") {
      await handleListOwnQuestionSubmissions(req, url, res);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/question-submissions") {
      await handleCreateQuestionSubmission(req, res);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/debug/questions") {
      if (!requireAdmin(req, res)) {
        return;
      }
      await handleDebugQuestions(res);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/debug/questions") {
      if (!requireAdmin(req, res)) {
        return;
      }
      await handleCreateDebugQuestion(req, res);
      return;
    }

    const debugQuestionMatch = url.pathname.match(/^\/api\/debug\/questions\/([^/]+)$/);
    if (debugQuestionMatch && req.method === "PUT") {
      if (!requireAdmin(req, res)) {
        return;
      }
      await handleUpdateDebugQuestion(req, res, decodeURIComponent(debugQuestionMatch[1]));
      return;
    }

    if (debugQuestionMatch && req.method === "DELETE") {
      if (!requireAdmin(req, res)) {
        return;
      }
      await handleDeleteDebugQuestion(res, decodeURIComponent(debugQuestionMatch[1]));
      return;
    }

    if (url.pathname === "/api/rooms" && req.method === "GET") {
      await handleListRooms(req, res);
      return;
    }

    if (url.pathname === "/api/rooms" && req.method === "PUT") {
      await handleUpsertRoom(req, res);
      return;
    }

    const roomGetMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)$/);
    if (roomGetMatch && req.method === "GET") {
      await handleGetRoom(req, res, roomGetMatch[1]);
      return;
    }

    const roomPresenceMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)\/presence$/);
    if (roomPresenceMatch && req.method === "POST") {
      await handleRoomPresence(req, res, roomPresenceMatch[1]);
      return;
    }

    const roomSettingsMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)\/settings$/);
    if (roomSettingsMatch && req.method === "PATCH") {
      await handleRoomSettings(req, res, roomSettingsMatch[1]);
      return;
    }

    const roomHeartbeatMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)\/heartbeat$/);
    if (roomHeartbeatMatch && req.method === "POST") {
      await handleRoomHeartbeat(req, res, roomHeartbeatMatch[1]);
      return;
    }

    const roomChatMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)\/chat$/);
    if (roomChatMatch && req.method === "POST") {
      await handleRoomChat(req, res, roomChatMatch[1]);
      return;
    }

    const roomGameMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)\/game$/);
    if (roomGameMatch && req.method === "PUT") {
      await handleRoomGame(req, res, roomGameMatch[1]);
      return;
    }

    const roomLobbyMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)\/lobby$/);
    if (roomLobbyMatch && req.method === "POST") {
      await handleRoomReturnToLobby(req, res, roomLobbyMatch[1]);
      return;
    }

    const roomRoundAdvancingMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)\/round-advancing$/);
    if (roomRoundAdvancingMatch && req.method === "POST") {
      await handleRoomRoundAdvancing(req, res, roomRoundAdvancingMatch[1]);
      return;
    }

    const roomRoundSetupMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)\/round-setup$/);
    if (roomRoundSetupMatch && req.method === "POST") {
      await handleRoomRoundSetup(req, res, roomRoundSetupMatch[1]);
      return;
    }

    const roomAnswerMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)\/answer$/);
    if (roomAnswerMatch && req.method === "POST") {
      await handleRoomAnswer(req, res, roomAnswerMatch[1]);
      return;
    }

    const roomGradingMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)\/grading$/);
    if (roomGradingMatch && req.method === "POST") {
      await handleRoomRoundGrading(req, res, roomGradingMatch[1]);
      return;
    }

    const roomPowerStateMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)\/power-state$/);
    if (roomPowerStateMatch && req.method === "POST") {
      await handleRoomPowerState(req, res, roomPowerStateMatch[1]);
      return;
    }

    const roomRoundResultMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)\/round-result$/);
    if (roomRoundResultMatch && req.method === "POST") {
      await handleRoomRoundResult(req, res, roomRoundResultMatch[1]);
      return;
    }

    const roomRoundSkipMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)\/round-skip$/);
    if (roomRoundSkipMatch && req.method === "POST") {
      await handleRoomRoundSkip(req, res, roomRoundSkipMatch[1]);
      return;
    }

    const roomEventsMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)\/events$/);
    if (roomEventsMatch && req.method === "GET") {
      await handleRoomEvents(req, url, res, roomEventsMatch[1]);
      return;
    }

    const roomModerationMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)\/moderation$/);
    if (roomModerationMatch && req.method === "POST") {
      await handleRoomModeration(req, res, roomModerationMatch[1]);
      return;
    }

    const roomCloseMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)\/close$/);
    if (roomCloseMatch && req.method === "POST") {
      await handleRoomClose(req, res, roomCloseMatch[1]);
      return;
    }

    const roomLeaveMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)\/leave$/);
    if (roomLeaveMatch && req.method === "POST") {
      await handleRoomLeave(req, res, roomLeaveMatch[1]);
      return;
    }

    if (url.pathname === "/api/admin/status" && req.method === "GET") {
      await handleAdminStatus(req, res);
      return;
    }

    if (url.pathname === "/api/admin/rooms" && req.method === "GET") {
      await handleAdminRooms(req, res);
      return;
    }

    if (url.pathname === "/api/admin/question-submissions" && req.method === "GET") {
      await handleAdminQuestionSubmissions(req, res);
      return;
    }

    const adminSubmissionActionMatch = url.pathname.match(/^\/api\/admin\/question-submissions\/([^/]+)\/(approve|deny)$/);
    if (adminSubmissionActionMatch && req.method === "POST") {
      await handleAdminReviewQuestionSubmission(req, res, adminSubmissionActionMatch[1], adminSubmissionActionMatch[2]);
      return;
    }

    const adminRoomMatch = url.pathname.match(/^\/api\/admin\/rooms\/([^/]+)$/);
    if (adminRoomMatch && req.method === "DELETE") {
      await handleAdminDeleteRoom(req, res, adminRoomMatch[1]);
      return;
    }

    const adminCloseRoomMatch = url.pathname.match(/^\/api\/admin\/rooms\/([^/]+)\/close$/);
    if (adminCloseRoomMatch && req.method === "POST") {
      await handleAdminCloseRoom(req, res, adminCloseRoomMatch[1]);
      return;
    }

    if (req.method !== "GET" && req.method !== "HEAD") {
      sendJson(res, 405, { error: "Method not allowed" });
      return;
    }

    await serveStatic(url.pathname, res, req.method === "HEAD", req);
  } catch (error) {
    console.error(error);
    sendJson(res, 500, { error: "Something went wrong." });
  }
}

if (require.main === module) {
  const server = createServer(handleRequest);

  server.on("error", (error) => {
    if (error.code === "EADDRINUSE") {
      console.error(`Port ${port} is already in use. Stop the other server or run with PORT=3001 npm start.`);
      process.exit(1);
    }

    if (error.code === "EACCES" || error.code === "EPERM") {
      console.error(`Cannot listen on ${host}:${port}. Try another port or check local permissions.`);
      process.exit(1);
    }

    throw error;
  });

  server.listen(port, host, () => {
    console.log(`Cards Against AI running at http://${host}:${port}`);
  });
}

handleRequest._test = {
  normalizeTriviaAnswer,
  scoreAnswerAgainstBank,
  normalizeGradingStrictness,
  getLocalGradingThreshold,
  isAnswerCorrectByStrictness,
  shouldAskAiForSecondOpinion
};

module.exports = handleRequest;

function loadEnv() {
  const envPath = join(root, ".env");
  if (!existsSync(envPath)) {
    return;
  }

  const lines = readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const splitAt = trimmed.indexOf("=");
    if (splitAt === -1) {
      continue;
    }

    const key = trimmed.slice(0, splitAt).trim();
    const rawValue = trimmed.slice(splitAt + 1).trim();
    const value = rawValue.replace(/^["']|["']$/g, "");
    if (key && !process.env[key]) {
      process.env[key] = value;
    }
  }
}

function checkRateLimit(req, res, url) {
  if (process.env.RATE_LIMIT_DISABLED === "true") {
    return true;
  }

  const config = getRateLimitConfig(req.method, url.pathname);
  if (!config) {
    return true;
  }

  const now = Date.now();
  const ip = getRequestIp(req);
  const key = `${config.name}:${ip}`;
  const bucket = rateLimitBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    rateLimitBuckets.set(key, { count: 1, resetAt: now + config.windowMs });
    pruneRateLimitBuckets(now);
    return true;
  }

  bucket.count += 1;
  if (bucket.count <= config.limit) {
    return true;
  }

  const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
  sendJson(res, 429, { error: "Too many requests. Try again shortly." }, {
    "Retry-After": String(retryAfterSeconds)
  });
  return false;
}

function getRateLimitConfig(method, pathname) {
  if (!pathname.startsWith("/api/")) {
    return null;
  }

  if (method === "POST" && pathname === "/api/auth/admin/login") {
    return { name: "admin-login", limit: 8, windowMs: 5 * 60 * 1000 };
  }
  if (method === "POST" && pathname === "/api/round") {
    return { name: "round-ai", limit: 30, windowMs: 60 * 1000 };
  }
  if (method === "GET" && pathname === "/api/image") {
    return { name: "image-proxy", limit: 90, windowMs: 60 * 1000 };
  }
  if (pathname.startsWith("/api/user/inventory")) {
    return { name: "inventory", limit: 180, windowMs: 60 * 1000 };
  }
  if (/^\/api\/rooms(?:\/|$)/.test(pathname)) {
    return { name: "rooms", limit: 600, windowMs: 60 * 1000 };
  }
  if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
    return { name: "api-write", limit: 300, windowMs: 60 * 1000 };
  }
  return { name: "api-read", limit: 900, windowMs: 60 * 1000 };
}

function pruneRateLimitBuckets(now = Date.now()) {
  if (rateLimitBuckets.size < 5000) {
    return;
  }
  for (const [key, bucket] of rateLimitBuckets.entries()) {
    if (bucket.resetAt <= now) {
      rateLimitBuckets.delete(key);
    }
  }
}

function getRequestIp(req) {
  const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return forwarded || String(req.socket?.remoteAddress || req.connection?.remoteAddress || "unknown");
}

function checkServerChatCooldown(req, code, participantId) {
  const now = Date.now();
  const key = `${String(code || "").toUpperCase()}:${String(participantId || "")}:${getRequestIp(req)}`;
  const existing = chatCooldownBuckets.get(key) || { timestamps: [], cooldownUntil: 0 };
  if (existing.cooldownUntil > now) {
    return { ok: false, retryAfterMs: existing.cooldownUntil - now };
  }

  const timestamps = existing.timestamps.filter((timestamp) => now - timestamp < 2000);
  if (timestamps.length >= 3) {
    const cooldownUntil = now + 10000;
    chatCooldownBuckets.set(key, { timestamps: [], cooldownUntil });
    pruneChatCooldownBuckets(now);
    return { ok: false, retryAfterMs: cooldownUntil - now };
  }

  timestamps.push(now);
  chatCooldownBuckets.set(key, { timestamps, cooldownUntil: 0 });
  pruneChatCooldownBuckets(now);
  return { ok: true, retryAfterMs: 0 };
}

function pruneChatCooldownBuckets(now = Date.now()) {
  if (chatCooldownBuckets.size < 5000) {
    return;
  }
  for (const [key, bucket] of chatCooldownBuckets.entries()) {
    const recent = (bucket.timestamps || []).some((timestamp) => now - timestamp < 2000);
    if (!recent && Number(bucket.cooldownUntil || 0) <= now) {
      chatCooldownBuckets.delete(key);
    }
  }
}

async function handleListRooms(req, res) {
  const rooms = (await listRoomsForDirectory())
    .filter((room) => room.status !== "complete")
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((room) => sanitizeRoomForClient(room, { includePrivateSecrets: hasRoomHostAuth(req, room) }));
  sendJson(res, 200, { rooms });
}

async function handleGetRoom(reqOrRes, resOrCode, maybeCode) {
  const req = maybeCode === undefined ? null : reqOrRes;
  const res = maybeCode === undefined ? reqOrRes : resOrCode;
  const code = maybeCode === undefined ? resOrCode : maybeCode;
  const normalizedCode = String(code || "").trim().toUpperCase();
  const room = await backendStore.getRoom(normalizedCode);
  if (!room) {
    const close = await backendStore.getRoomClose(normalizedCode);
    if (close) {
      sendJson(res, 410, { closed: true, close });
      return;
    }
    sendJson(res, 404, { error: "Room not found.", code: normalizedCode });
    return;
  }
  const activeRoom = await ensureRoomReconnectGrace(room);
  if (!activeRoom) {
    sendJson(res, 410, { closed: true, close: createRoomClosePayload(normalizedCode, "host-disconnected") });
    return;
  }
  sendJson(res, 200, {
    room: sanitizeRoomForClient(activeRoom, { includePrivateSecrets: req ? hasRoomHostAuth(req, activeRoom) : false })
  });
}

async function handleAdminStatus(req, res) {
  if (!requireAdmin(req, res)) {
    return;
  }

  const rooms = await listRoomsForDirectory();
  const runtimeQuestionBank = await getRuntimeQuestionBank();
  sendJson(res, 200, {
    ok: true,
    storage: {
      mode: backendStore.mode,
      persistent: backendStore.persistent,
      roomTtlSeconds: backendStore.roomTtlSeconds
    },
    rooms: {
      total: rooms.length,
      active: rooms.filter((room) => room.status !== "complete").length,
      complete: rooms.filter((room) => room.status === "complete").length
    },
    questions: {
      total: runtimeQuestionBank.length,
      themes: triviaThemes
    }
  });
}

async function handleAdminRooms(req, res) {
  if (!requireAdmin(req, res)) {
    return;
  }

  const rooms = (await listRoomsForDirectory())
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((room) => ({
      code: room.code,
      status: room.status,
      host: {
        id: room.host?.id || "",
        name: room.host?.name || "Host"
      },
      settings: {
        rounds: room.settings?.rounds,
        timerSeconds: room.settings?.timerSeconds,
        maxPlayers: room.settings?.maxPlayers,
        private: Boolean(room.settings?.private),
        classicMode: Boolean(room.settings?.classicMode),
        autoAdvance: room.settings?.autoAdvance !== false
      },
      participants: Array.isArray(room.participants)
        ? room.participants.map((participant) => ({
          id: participant.id,
          name: participant.name,
          role: normalizeParticipantRole(participant),
          host: Boolean(participant.host),
          spectator: Boolean(participant.spectator),
          active: participant.active !== false,
          muted: Boolean(participant.muted),
          status: participant.status,
          bot: Boolean(participant.bot)
        }))
        : [],
      chat: Array.isArray(room.chat) ? room.chat : [],
      activePlayers: room.activePlayers || 0,
      spectators: room.spectators || 0,
      updatedAt: room.updatedAt || 0
    }));

  sendJson(res, 200, { rooms });
}

async function handleAdminDeleteRoom(req, res, code) {
  if (!requireAdmin(req, res)) {
    return;
  }

  const normalizedCode = String(code || "").trim().toUpperCase();
  const deleted = await closeStoredRoom(normalizedCode, "admin-delete");
  sendJson(res, deleted ? 200 : 404, {
    deleted,
    code: normalizedCode
  });
}

async function handleAdminCloseRoom(req, res, code) {
  if (!requireAdmin(req, res)) {
    return;
  }

  const room = await backendStore.getRoom(code);
  if (!room) {
    sendJson(res, 404, { error: "Room not found." });
    return;
  }

  room.status = "complete";
  room.closed = createRoomClosePayload(code, "admin");
  finalizeRoom(room);
  stampRoomEvent(room, "room_closed", { reason: "admin" });
  const storedRoom = await backendStore.upsertRoom(room);
  await backendStore.upsertRoomClose(room.closed);
  sendJson(res, 200, { room: sanitizeRoomForClient(storedRoom, { includePrivateSecrets: true }) });
}

async function handleImageProxy(url, res) {
  const source = String(url.searchParams.get("src") || "");
  if (!isAllowedImageProxyUrl(source) || !(await isAllowedResolvedImageProxyUrl(source))) {
    sendText(res, 400, "Invalid image source");
    return;
  }

  try {
    const image = await fetchImageAsset(source, 14000);

    res.writeHead(200, {
      ...getSecurityHeaders(),
      "Content-Type": image.contentType,
      "Cache-Control": "public, max-age=86400",
      "X-Content-Type-Options": "nosniff"
    });
    res.end(image.buffer);
  } catch {
    sendText(res, 502, "Image fetch failed");
  }
}

async function handleListOwnQuestionSubmissions(req, url, res) {
  const creatorId = String(url.searchParams.get("creatorId") || "").trim().slice(0, 120);
  if (!creatorId) {
    sendJson(res, 400, { error: "Missing creatorId." });
    return;
  }
  const authContext = getQuestionSubmissionAuthContext(req, creatorId);
  if (!authContext.ok) {
    sendJson(res, authContext.status, { error: authContext.error });
    return;
  }

  const submissions = (await backendStore.listQuestionSubmissions())
    .filter((submission) => submission.creator?.id === authContext.userId)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map(sanitizeQuestionSubmissionForCreator);
  sendJson(res, 200, {
    submissions,
    ...(authContext.warnings.length ? { warnings: authContext.warnings } : {}),
    authenticated: authContext.authenticated
  });
}

async function handleCreateQuestionSubmission(req, res) {
  try {
    const body = await readRequestJson(req);
    const question = normalizeCreatedQuestion(body.question || body);
    const creator = body.creator && typeof body.creator === "object" ? body.creator : {};
    const requestedCreatorId = String(creator.id || "").trim().slice(0, 120);
    const authContext = getQuestionSubmissionAuthContext(req, requestedCreatorId);
    if (!authContext.ok) {
      sendJson(res, authContext.status, { error: authContext.error });
      return;
    }
    const creatorId = authContext.userId;
    if (!creatorId) {
      throw new Error("Missing creator id.");
    }

    const now = Date.now();
    const submission = {
      id: `sub-${now}-${Math.random().toString(36).slice(2, 10)}`,
      status: "pending",
      question,
      creator: {
        id: creatorId,
        name: String(creator.name || "Player").trim().slice(0, 32)
      },
      cost: 250,
      createdAt: now,
      updatedAt: now,
      review: null
    };
    const storedSubmission = await backendStore.upsertQuestionSubmission(submission);
    sendJson(res, 201, {
      submission: sanitizeQuestionSubmissionForCreator(storedSubmission),
      ...(authContext.warnings.length ? { warnings: authContext.warnings } : {}),
      authenticated: authContext.authenticated
    });
  } catch (error) {
    sendJson(res, 400, { error: error.message || "Question submission failed." });
  }
}

async function handleAdminQuestionSubmissions(req, res) {
  if (!requireAdmin(req, res)) {
    return;
  }

  const submissions = (await backendStore.listQuestionSubmissions())
    .sort((a, b) => b.updatedAt - a.updatedAt);
  sendJson(res, 200, { submissions });
}

async function handleAdminReviewQuestionSubmission(req, res, id, action) {
  if (!requireAdmin(req, res)) {
    return;
  }

  try {
    const submission = await backendStore.getQuestionSubmission(id);
    if (!submission) {
      sendJson(res, 404, { error: "Submission not found." });
      return;
    }
    if (submission.status !== "pending") {
      sendJson(res, 409, { error: `Submission is already ${submission.status}.` });
      return;
    }

    const body = await readRequestJson(req);
    const now = Date.now();
    if (action === "deny") {
      const reason = String(body.reason || "").trim().replace(/\s+/g, " ").slice(0, 280);
      if (!reason) {
        sendJson(res, 400, { error: "A denial reason is required." });
        return;
      }
      submission.status = "denied";
      submission.updatedAt = now;
      submission.review = { reason, reviewedAt: now };
      const storedSubmission = await backendStore.upsertQuestionSubmission(submission);
      sendJson(res, 200, { submission: storedSubmission });
      return;
    }

    const question = normalizeCreatedQuestion(body.question || submission.question);
    const saved = await saveApprovedQuestion(question);
    submission.status = "approved";
    submission.question = question;
    submission.updatedAt = now;
    submission.review = { approvedAt: now, savedId: saved.question.id, fileSaved: saved.fileSaved };
    const storedSubmission = await backendStore.upsertQuestionSubmission(submission);
    sendJson(res, 200, { submission: storedSubmission, total: saved.total });
  } catch (error) {
    sendJson(res, 400, { error: error.message || "Submission review failed." });
  }
}

async function saveApprovedQuestion(question) {
  const normalizedId = normalizeQuestionText(question.id);
  const runtimeQuestionBank = await getRuntimeQuestionBank();
  if (runtimeQuestionBank.some((entry) => normalizeQuestionText(entry.id) === normalizedId)) {
    throw new Error(`Question id already exists: ${question.id}`);
  }

  const filePath = join(root, "data", "questions.json");
  let total = runtimeQuestionBank.length + 1;
  let fileSaved = false;
  try {
    const current = JSON.parse(readFileSync(filePath, "utf8"));
    if (!Array.isArray(current)) {
      throw new Error("Question bank is not an array.");
    }
    current.push(question);
    await writeFile(filePath, `${JSON.stringify(current, null, 2)}\n`);
    total = current.length;
    fileSaved = true;
  } catch (error) {
    if (!["EROFS", "EACCES", "EPERM"].includes(error.code)) {
      throw error;
    }
    console.warn("Could not write approved question to data/questions.json; keeping it in persistent review storage.", error.message || error);
  }

  const normalized = normalizeSeedQuestion(question);
  if (normalized && !questionBank.some((entry) => normalizeQuestionText(entry.id) === normalizedId)) {
    questionBank.push(normalized);
  }
  return { question, total, fileSaved };
}

function sanitizeQuestionSubmissionForCreator(submission) {
  return {
    id: submission.id,
    status: submission.status,
    question: submission.question,
    cost: submission.cost || 250,
    createdAt: submission.createdAt || 0,
    updatedAt: submission.updatedAt || 0,
    review: submission.review || null
  };
}

function handleAuthSession(req, res) {
  const session = getAdminSession(req);
  sendJson(res, 200, {
    authenticated: Boolean(session),
    user: session ? { role: "admin", name: "Admin" } : null
  });
}

function handleSupabaseConfig(res) {
  const url = getSupabaseUrl();
  const anonKey = getSupabaseAnonKey();
  sendJson(res, 200, {
    enabled: Boolean(url && anonKey),
    url,
    anonKey
  });
}

async function handleAdminLogin(req, res) {
  const configuredToken = getAdminToken();
  if (!configuredToken) {
    sendJson(res, 503, { error: "ADMIN_TOKEN is not configured." });
    return;
  }

  try {
    const body = await readRequestJson(req);
    const token = String(body.token || body.password || "").trim();
    if (!secureEqual(token, configuredToken)) {
      sendJson(res, 401, { error: "Invalid admin token." });
      return;
    }

    const expiresAt = Date.now() + adminSessionTtlSeconds * 1000;
    const value = createAdminSessionCookie(expiresAt);
    res.writeHead(200, {
      ...getSecurityHeaders(),
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Set-Cookie": serializeCookie(adminCookieName, value, {
        httpOnly: true,
        sameSite: "Strict",
        secure: isSecureRequest(req),
        path: "/",
        maxAge: adminSessionTtlSeconds
      })
    });
    res.end(JSON.stringify({
      authenticated: true,
      user: { role: "admin", name: "Admin" }
    }));
  } catch (error) {
    sendJson(res, 400, { error: error.message || "Admin login failed." });
  }
}

function handleLogout(req, res) {
  res.writeHead(200, {
    ...getSecurityHeaders(),
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Set-Cookie": serializeCookie(adminCookieName, "", {
      httpOnly: true,
      sameSite: "Strict",
      secure: isSecureRequest(req),
      path: "/",
      maxAge: 0
    })
  });
  res.end(JSON.stringify({ authenticated: false }));
}

async function handleGetUserInventory(req, url, res) {
  const requestedUserId = normalizeInventoryUserId(url.searchParams.get("userId"));
  const authContext = getInventoryAuthContext(req, requestedUserId);
  if (!authContext.ok) {
    sendJson(res, authContext.status, { error: authContext.error });
    return;
  }
  if (!authContext.userId) {
    sendJson(res, 400, { error: "Missing userId." });
    return;
  }

  const inventory = await getOrCreateUserInventory(authContext.userId);
  sendJson(res, 200, {
    inventory: sanitizeUserInventoryForClient(inventory),
    ...(authContext.warnings.length ? { warnings: authContext.warnings } : {}),
    authenticated: authContext.authenticated
  });
}

async function handleUserInventoryOps(req, res) {
  try {
    const body = await readRequestJson(req, { maxBytes: 500_000 });
    const requestedUserId = normalizeInventoryUserId(body.userId);
    const authContext = getInventoryAuthContext(req, requestedUserId);
    if (!authContext.ok) {
      sendJson(res, authContext.status, { error: authContext.error });
      return;
    }
    const userId = authContext.userId;
    if (!userId) {
      sendJson(res, 400, { error: "Missing userId." });
      return;
    }

    const ops = Array.isArray(body.ops) ? body.ops.slice(0, 100) : [];
    if (!ops.length) {
      const inventory = await getOrCreateUserInventory(userId);
      sendJson(res, 200, {
        inventory: sanitizeUserInventoryForClient(inventory),
        applied: [],
        skipped: [],
        ...(authContext.warnings.length ? { warnings: authContext.warnings } : {}),
        authenticated: authContext.authenticated
      });
      return;
    }

    const inventory = await getOrCreateUserInventory(userId);
    const applied = [];
    const skipped = [];
    ops.forEach((op) => {
      const blocked = getBlockedLegacyEconomyOpResult(op, authContext);
      if (blocked) {
        skipped.push(blocked);
        return;
      }
      const result = applyUserInventoryOp(inventory, op);
      if (result.applied) {
        applied.push(result.id);
      } else if (result.id) {
        skipped.push({ id: result.id, reason: result.reason || "skipped" });
      }
    });
    pruneUserInventory(inventory);
    const storedInventory = await backendStore.upsertUserInventory(inventory);
    sendJson(res, 200, {
      inventory: sanitizeUserInventoryForClient(storedInventory),
      applied,
      skipped,
      ...(authContext.warnings.length ? { warnings: authContext.warnings } : {}),
      authenticated: authContext.authenticated
    });
  } catch (error) {
    sendJson(res, 400, { error: error.message || "Inventory update failed." });
  }
}

async function handleUserInventoryPurchase(req, res) {
  try {
    const body = await readRequestJson(req, { maxBytes: 50_000 });
    const authContext = getInventoryAuthContext(req, normalizeInventoryUserId(body.userId));
    if (!authContext.ok) {
      sendJson(res, authContext.status, { error: authContext.error });
      return;
    }
    if (!authContext.userId) {
      sendJson(res, 400, { error: "Missing userId." });
      return;
    }

    const key = normalizeInventoryPurchaseKey(body);
    const catalogItem = inventoryShopCatalog.get(key);
    if (!key || !catalogItem) {
      sendJson(res, 400, { error: "Invalid shop item." });
      return;
    }
    const purchaseAt = Math.max(0, Number(body.purchaseAt) || Date.now());
    if (!isInventoryShopPurchaseAvailable(key, purchaseAt)) {
      sendJson(res, 409, {
        error: "This item is not in the current rotating shop.",
        purchase: {
          key,
          cost: catalogItem.cost,
          purchased: false,
          reason: "shop-rotation-locked"
        }
      });
      return;
    }

    const inventory = await getOrCreateUserInventory(authContext.userId);
    const opId = normalizeInventoryOpId(body.opId || createServerInventoryOpId("purchase-cosmetic", key));
    const result = applyUserInventoryOp(inventory, {
      id: opId,
      type: "purchase-cosmetic",
      key,
      purchaseAt
    });
    const shouldStore = result.applied;
    const storedInventory = shouldStore
      ? await backendStore.upsertUserInventory(pruneAndReturnUserInventory(inventory))
      : inventory;
    sendInventoryMutationResult(res, result.applied ? 200 : 409, storedInventory, {
      applied: result.applied ? [result.id] : [],
      skipped: result.applied ? [] : [{ id: result.id, reason: result.reason || "skipped" }],
      authenticated: authContext.authenticated,
      warnings: authContext.warnings,
      purchase: {
        key,
        cost: catalogItem.cost,
        purchased: result.applied,
        reason: result.reason || ""
      },
      ...(result.applied ? {} : { error: result.reason || "Purchase failed." })
    });
  } catch (error) {
    sendJson(res, 400, { error: error.message || "Inventory purchase failed." });
  }
}

async function handleUserInventoryMilestone(req, res) {
  try {
    const body = await readRequestJson(req, { maxBytes: 50_000 });
    const authContext = getInventoryAuthContext(req, normalizeInventoryUserId(body.userId));
    if (!authContext.ok) {
      sendJson(res, authContext.status, { error: authContext.error });
      return;
    }
    if (!authContext.userId) {
      sendJson(res, 400, { error: "Missing userId." });
      return;
    }

    const milestoneId = normalizeInventoryKey(body.milestoneId || body.key);
    if (!milestoneId || !inventoryMilestoneRewards.has(milestoneId)) {
      sendJson(res, 400, { error: "Invalid milestone." });
      return;
    }

    const inventory = await getOrCreateUserInventory(authContext.userId);
    const opId = normalizeInventoryOpId(body.opId || createServerInventoryOpId("milestone", milestoneId));
    const result = applyUserInventoryOp(inventory, {
      id: opId,
      type: "milestone",
      milestoneId,
      coinDelta: inventoryMilestoneRewards.get(milestoneId)
    });
    const storedInventory = result.applied
      ? await backendStore.upsertUserInventory(pruneAndReturnUserInventory(inventory))
      : inventory;
    sendInventoryMutationResult(res, 200, storedInventory, {
      applied: result.applied ? [result.id] : [],
      skipped: result.applied ? [] : [{ id: result.id, reason: result.reason || "skipped" }],
      authenticated: authContext.authenticated,
      warnings: authContext.warnings,
      milestone: {
        milestoneId,
        coins: inventoryMilestoneRewards.get(milestoneId),
        claimed: result.applied,
        reason: result.reason || ""
      }
    });
  } catch (error) {
    sendJson(res, 400, { error: error.message || "Inventory milestone claim failed." });
  }
}

function sendInventoryMutationResult(res, status, inventory, details = {}) {
  const warnings = Array.isArray(details.warnings) ? details.warnings : [];
  sendJson(res, status, {
    inventory: sanitizeUserInventoryForClient(inventory),
    applied: Array.isArray(details.applied) ? details.applied : [],
    skipped: Array.isArray(details.skipped) ? details.skipped : [],
    ...(warnings.length ? { warnings } : {}),
    authenticated: Boolean(details.authenticated),
    ...(details.purchase ? { purchase: details.purchase } : {}),
    ...(details.milestone ? { milestone: details.milestone } : {}),
    ...(details.error ? { error: details.error } : {})
  });
}

function normalizeInventoryPurchaseKey(body = {}) {
  const explicitKey = normalizeInventoryKey(body.key);
  if (explicitKey) {
    return explicitKey;
  }
  const type = normalizeInventoryKey(body.type);
  const id = normalizeInventoryKey(body.id);
  return type && id ? `${type}:${id}` : "";
}

function getProfileShopRotationSlot(timeMs = Date.now()) {
  return Math.floor(Math.max(0, Number(timeMs) || 0) / profileShopRotationIntervalMs);
}

function hashProfileShopRotationValue(value = "", seed = 0) {
  let hash = 2166136261 ^ (Number(seed) >>> 0);
  String(value).split("").forEach((char) => {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  });
  return hash >>> 0;
}

function getProfileShopRotationKeys(timeMs = Date.now()) {
  const slot = getProfileShopRotationSlot(timeMs);
  return inventoryShopCatalogKeys
    .map((key) => ({
      key,
      sort: hashProfileShopRotationValue(key, slot)
    }))
    .sort((a, b) => a.sort - b.sort || a.key.localeCompare(b.key))
    .slice(0, profileShopRotationSize)
    .map((entry) => entry.key);
}

function isInventoryShopKeyInRotation(key, timeMs = Date.now()) {
  return getProfileShopRotationKeys(timeMs).includes(key);
}

function isInventoryShopPurchaseAvailable(key, purchaseAt = Date.now(), now = Date.now()) {
  if (!key || isInventoryShopKeyInRotation(key, now)) {
    return Boolean(key);
  }
  const stampedAt = Math.max(0, Number(purchaseAt) || 0);
  if (!stampedAt || stampedAt > now + 5 * 60 * 1000 || now - stampedAt > profileShopRotationPurchaseGraceMs) {
    return false;
  }
  return isInventoryShopKeyInRotation(key, stampedAt);
}

function createServerInventoryOpId(type, key) {
  return normalizeInventoryOpId(`${type}:${key}:${Date.now()}:${randomBytes(4).toString("hex")}`);
}

function getBlockedLegacyEconomyOpResult(rawOp, authContext) {
  if (authContext.mode !== "enforce") {
    return null;
  }

  const op = rawOp && typeof rawOp === "object" ? rawOp : {};
  const id = normalizeInventoryOpId(op.id);
  const type = String(op.type || "").trim();
  if (type === "purchase-cosmetic") {
    return { id, reason: "use-purchase-endpoint" };
  }
  if (type === "milestone" && Object.prototype.hasOwnProperty.call(op, "coinDelta")) {
    return { id, reason: "use-milestone-endpoint" };
  }
  return null;
}

function getInventoryAuthContext(req, requestedUserId) {
  const mode = getInventoryAuthMode();
  if (mode === "off") {
    return {
      ok: true,
      userId: requestedUserId,
      authenticated: false,
      warnings: [],
      mode
    };
  }

  const warnings = [];
  const auth = getAuthenticatedUser(req);
  if (auth.ok) {
    if (requestedUserId && requestedUserId !== auth.userId) {
      if (mode === "enforce") {
        return {
          ok: false,
          status: 403,
          error: "Inventory user does not match authenticated user."
        };
      }
      warnings.push("inventory-user-id-overridden-by-auth");
    }
    return {
      ok: true,
      userId: auth.userId,
      authenticated: true,
      warnings,
      mode
    };
  }

  if (mode === "enforce") {
    return {
      ok: false,
      status: auth.status || 401,
      error: auth.error || "Authentication is required for inventory."
    };
  }

  if (auth.error) {
    warnings.push("inventory-auth-token-not-verified");
  } else {
    warnings.push("inventory-auth-missing");
  }

  return {
    ok: true,
    userId: requestedUserId,
    authenticated: false,
    warnings,
    mode
  };
}

function getInventoryAuthMode() {
  const fallback = process.env.NODE_ENV === "production" ? "enforce" : "warn";
  const mode = String(process.env.INVENTORY_AUTH_MODE || fallback).trim().toLowerCase();
  return ["off", "warn", "enforce"].includes(mode) ? mode : "warn";
}

function getQuestionSubmissionAuthContext(req, requestedCreatorId) {
  const explicitMode = String(process.env.QUESTION_SUBMISSION_AUTH_MODE || "").trim().toLowerCase();
  const mode = ["off", "warn", "enforce"].includes(explicitMode) ? explicitMode : getInventoryAuthMode();
  if (mode === "off") {
    return {
      ok: true,
      userId: requestedCreatorId,
      authenticated: false,
      warnings: []
    };
  }

  const warnings = [];
  const auth = getAuthenticatedUser(req);
  if (auth.ok) {
    if (requestedCreatorId && requestedCreatorId !== auth.userId) {
      if (mode === "enforce") {
        return {
          ok: false,
          status: 403,
          error: "Submission creator does not match authenticated user."
        };
      }
      warnings.push("submission-creator-id-overridden-by-auth");
    }
    return {
      ok: true,
      userId: auth.userId,
      authenticated: true,
      warnings
    };
  }

  if (mode === "enforce") {
    return {
      ok: false,
      status: auth.status || 401,
      error: auth.error || "Authentication is required for question submissions."
    };
  }

  warnings.push(auth.error ? "submission-auth-token-not-verified" : "submission-auth-missing");
  return {
    ok: true,
    userId: requestedCreatorId,
    authenticated: false,
    warnings
  };
}

function getAuthenticatedUser(req) {
  const token = getBearerToken(req);
  if (!token) {
    return { ok: false, error: "" };
  }

  const secret = getSupabaseJwtSecret();
  if (!secret) {
    return {
      ok: false,
      status: 503,
      error: "SUPABASE_JWT_SECRET is not configured."
    };
  }

  try {
    const payload = verifySupabaseJwt(token, secret);
    const userId = normalizeInventoryUserId(payload.sub);
    if (!userId) {
      return { ok: false, status: 401, error: "Invalid authentication token." };
    }
    return {
      ok: true,
      userId,
      payload
    };
  } catch {
    return { ok: false, status: 401, error: "Invalid authentication token." };
  }
}

function getBearerToken(req) {
  const authorization = String(req?.headers?.authorization || "");
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

function verifySupabaseJwt(token, secret) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3 || parts.some((part) => !part)) {
    throw new Error("Invalid JWT.");
  }

  const [encodedHeader, encodedPayload, signature] = parts;
  const header = JSON.parse(Buffer.from(encodedHeader, "base64url").toString("utf8"));
  if (header.alg !== "HS256") {
    throw new Error("Unsupported JWT algorithm.");
  }

  const expectedSignature = createHmac("sha256", secret)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest("base64url");
  if (!secureEqual(signature, expectedSignature)) {
    throw new Error("Invalid JWT signature.");
  }

  const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (payload.exp !== undefined && Number(payload.exp) <= nowSeconds) {
    throw new Error("JWT expired.");
  }
  if (payload.nbf !== undefined && Number(payload.nbf) > nowSeconds + 60) {
    throw new Error("JWT not active.");
  }
  return payload;
}

async function getOrCreateUserInventory(userId) {
  const stored = await backendStore.getUserInventory(userId);
  return normalizeUserInventory(stored || { userId });
}

function normalizeUserInventory(source = {}) {
  const userId = normalizeInventoryUserId(source.userId);
  const achievements = source.achievements && typeof source.achievements === "object" ? source.achievements : {};
  const achievementProgress = source.achievementProgress && typeof source.achievementProgress === "object" ? source.achievementProgress : {};
  const appliedOps = source.appliedOps && typeof source.appliedOps === "object" ? source.appliedOps : {};
  return {
    userId,
    profile: normalizeInventoryProfile(source.profile),
    coins: Math.max(0, Math.floor(Number(source.coins) || 0)),
    coinTransactions: Array.isArray(source.coinTransactions)
      ? source.coinTransactions.map(normalizeCoinTransaction).filter(Boolean).slice(-250)
      : [],
    cosmetics: [...new Set((Array.isArray(source.cosmetics) ? source.cosmetics : [])
      .map(normalizeInventoryKey)
      .filter(Boolean))].slice(0, 1000),
    achievements: Object.fromEntries(Object.entries(achievements)
      .map(([id, record]) => [normalizeInventoryKey(id), normalizeAchievementRecord(record)])
      .filter(([id]) => id)),
    achievementProgress: Object.fromEntries(Object.entries(achievementProgress)
      .map(([key, value]) => [normalizeInventoryKey(key), Math.max(0, Math.floor(Number(value) || 0))])
      .filter(([key]) => key)),
    claimedMilestones: [...new Set((Array.isArray(source.claimedMilestones) ? source.claimedMilestones : [])
      .map(normalizeInventoryKey)
      .filter(Boolean))].slice(0, 500),
    appliedOps: Object.fromEntries(Object.entries(appliedOps)
      .map(([id, appliedAt]) => [normalizeInventoryOpId(id), clampServerNumber(appliedAt, 0, Number.MAX_SAFE_INTEGER, 0)])
      .filter(([id, appliedAt]) => id && appliedAt > 0)
      .slice(-1000)),
    updatedAt: clampServerNumber(source.updatedAt, 0, Number.MAX_SAFE_INTEGER, Date.now())
  };
}

function applyUserInventoryOp(inventory, rawOp) {
  const op = rawOp && typeof rawOp === "object" ? rawOp : {};
  const id = normalizeInventoryOpId(op.id);
  if (!id) {
    return { applied: false, id: "", reason: "missing-id" };
  }
  if (inventory.appliedOps[id]) {
    return { applied: false, id, reason: "already-applied" };
  }

  const type = String(op.type || "").trim();
  const now = Date.now();
  let applied = false;
  if (type === "coin") {
    const mode = String(op.mode || "").trim().toLowerCase();
    if (mode === "max" || mode === "reconcile") {
      const value = clampServerNumber(op.value, 0, 1_000_000_000, inventory.coins);
      const coveredCoinOps = Array.isArray(op.coveredCoinOps) ? op.coveredCoinOps.slice(0, 200) : [];
      const coveredDelta = coveredCoinOps.reduce((total, coveredOp) => {
        const coveredId = normalizeInventoryOpId(coveredOp?.id);
        if (!coveredId || coveredId === id || inventory.appliedOps[coveredId]) {
          return total;
        }
        inventory.appliedOps[coveredId] = now;
        return total + clampInventoryDelta(coveredOp?.delta);
      }, 0);
      const reconciledBalance = Math.max(0, Math.floor(Number(inventory.coins) || 0) + coveredDelta);
      const targetBalance = Math.max(reconciledBalance, value);
      const delta = targetBalance - Math.max(0, Math.floor(Number(inventory.coins) || 0));
      if (delta) {
        applyCoinTransaction(inventory, id, delta, op.reason || "state-sync", now);
      } else {
        inventory.coins = targetBalance;
      }
      applied = true;
    } else {
      const delta = clampInventoryDelta(op.delta);
      if (!delta) {
        return { applied: false, id, reason: "empty-delta" };
      }
      if (inventory.coins + delta < 0) {
        return { applied: false, id, reason: "insufficient-coins" };
      }
      applyCoinTransaction(inventory, id, delta, op.reason || "adjustment", now);
      applied = true;
    }
  } else if (type === "purchase-cosmetic") {
    const key = normalizeInventoryKey(op.key);
    const catalogItem = inventoryShopCatalog.get(key);
    if (!key) {
      return { applied: false, id, reason: "missing-cosmetic" };
    }
    if (!catalogItem) {
      return { applied: false, id, reason: "invalid-shop-item" };
    }
    if (!isInventoryShopPurchaseAvailable(key, op.purchaseAt || op.createdAt || now, now)) {
      return { applied: false, id, reason: "shop-rotation-locked" };
    }
    const cost = catalogItem.cost;
    if (inventory.cosmetics.includes(key)) {
      applied = true;
    } else {
      if (inventory.coins < cost) {
        return { applied: false, id, reason: "insufficient-coins" };
      }
      if (cost > 0) {
        applyCoinTransaction(inventory, id, -cost, `purchase:${key}`, now);
      }
      inventory.cosmetics.push(key);
      applied = true;
    }
  } else if (type === "cosmetic") {
    const key = normalizeInventoryKey(op.key);
    if (!key) {
      return { applied: false, id, reason: "missing-cosmetic" };
    }
    if (!inventory.cosmetics.includes(key)) {
      inventory.cosmetics.push(key);
    }
    applied = true;
  } else if (type === "achievement") {
    const achievementId = normalizeInventoryKey(op.achievementId || op.key);
    if (!achievementId) {
      return { applied: false, id, reason: "missing-achievement" };
    }
    inventory.achievements[achievementId] = {
      ...normalizeAchievementRecord(op.record),
      unlockedAt: normalizeAchievementRecord(op.record).unlockedAt || new Date(now).toISOString()
    };
    applied = true;
  } else if (type === "achievement-progress") {
    const key = normalizeInventoryKey(op.key);
    if (!key) {
      return { applied: false, id, reason: "missing-progress-key" };
    }
    const value = Math.max(0, Math.floor(Number(op.value) || 0));
    const current = Math.max(0, Math.floor(Number(inventory.achievementProgress[key]) || 0));
    if (op.mode === "add") {
      inventory.achievementProgress[key] = current + value;
    } else if (op.mode === "max") {
      inventory.achievementProgress[key] = Math.max(current, value);
    } else {
      inventory.achievementProgress[key] = value;
    }
    applied = true;
  } else if (type === "milestone") {
    const milestoneId = normalizeInventoryKey(op.milestoneId || op.key);
    if (!milestoneId) {
      return { applied: false, id, reason: "missing-milestone" };
    }
    if (!inventoryMilestoneRewards.has(milestoneId)) {
      return { applied: false, id, reason: "invalid-milestone" };
    }
    if (!inventory.claimedMilestones.includes(milestoneId)) {
      inventory.claimedMilestones.push(milestoneId);
      const coinDelta = Object.prototype.hasOwnProperty.call(op, "coinDelta")
        ? inventoryMilestoneRewards.get(milestoneId)
        : 0;
      if (coinDelta) {
        applyCoinTransaction(inventory, id, coinDelta, `milestone:${milestoneId}`, now);
      }
    }
    applied = true;
  } else if (type === "profile") {
    inventory.profile = normalizeInventoryProfile({
      ...inventory.profile,
      ...(op.profile && typeof op.profile === "object" ? op.profile : {}),
      equippedAchievementId: op.equippedAchievementId ?? op.profile?.equippedAchievementId ?? inventory.profile?.equippedAchievementId,
      cardCustomization: op.cardCustomization || op.profile?.cardCustomization || inventory.profile?.cardCustomization
    });
    applied = true;
  } else {
    return { applied: false, id, reason: "unknown-type" };
  }

  if (applied) {
    inventory.appliedOps[id] = now;
    inventory.updatedAt = now;
  }
  return { applied, id };
}

function applyCoinTransaction(inventory, id, delta, reason, now = Date.now()) {
  const cleanDelta = clampInventoryDelta(delta);
  inventory.coins = Math.max(0, Math.floor(Number(inventory.coins) || 0) + cleanDelta);
  inventory.coinTransactions.push({
    id,
    delta: cleanDelta,
    reason: String(reason || "adjustment").trim().replace(/\s+/g, "-").slice(0, 80),
    createdAt: now
  });
}

function pruneUserInventory(inventory) {
  inventory.coinTransactions = (inventory.coinTransactions || []).slice(-250);
  inventory.cosmetics = [...new Set((inventory.cosmetics || []).map(normalizeInventoryKey).filter(Boolean))].slice(0, 1000);
  inventory.claimedMilestones = [...new Set((inventory.claimedMilestones || []).map(normalizeInventoryKey).filter(Boolean))].slice(0, 500);
  const appliedEntries = Object.entries(inventory.appliedOps || {})
    .sort((a, b) => Number(a[1]) - Number(b[1]))
    .slice(-1000);
  inventory.appliedOps = Object.fromEntries(appliedEntries);
}

function pruneAndReturnUserInventory(inventory) {
  pruneUserInventory(inventory);
  return inventory;
}

function sanitizeUserInventoryForClient(inventory) {
  const normalized = normalizeUserInventory(inventory);
  return {
    userId: normalized.userId,
    profile: normalized.profile,
    coins: normalized.coins,
    coinTransactions: normalized.coinTransactions,
    cosmetics: normalized.cosmetics,
    achievements: normalized.achievements,
    achievementProgress: normalized.achievementProgress,
    claimedMilestones: normalized.claimedMilestones,
    updatedAt: normalized.updatedAt
  };
}

function normalizeCoinTransaction(transaction) {
  const source = transaction && typeof transaction === "object" ? transaction : {};
  const id = normalizeInventoryOpId(source.id);
  const delta = clampInventoryDelta(source.delta);
  if (!id || !delta) {
    return null;
  }
  return {
    id,
    delta,
    reason: String(source.reason || "adjustment").trim().replace(/\s+/g, "-").slice(0, 80),
    createdAt: clampServerNumber(source.createdAt, 0, Number.MAX_SAFE_INTEGER, Date.now())
  };
}

function normalizeAchievementRecord(record) {
  const source = record && typeof record === "object" ? record : {};
  return {
    unlockedAt: String(source.unlockedAt || "").slice(0, 40),
    source: String(source.source || (source.debug ? "debug" : "game")).slice(0, 40),
    debug: Boolean(source.debug)
  };
}

function normalizeInventoryProfile(profile) {
  const source = profile && typeof profile === "object" ? profile : {};
  return {
    equippedAchievementId: normalizeInventoryKey(source.equippedAchievementId || source.equippedTitleId || ""),
    cardCustomization: normalizeInventoryCardCustomization(source.cardCustomization)
  };
}

function normalizeInventoryCardCustomization(customization) {
  const source = customization && typeof customization === "object" ? customization : {};
  return {
    styleId: normalizeInventoryKey(source.styleId || "default"),
    gradientTop: normalizeInventoryKey(source.gradientTop || "blue"),
    gradientBottom: normalizeInventoryKey(source.gradientBottom || "pink"),
    effectIds: [...new Set((Array.isArray(source.effectIds) ? source.effectIds : []).map(normalizeInventoryKey).filter(Boolean))].slice(0, 12),
    patternId: normalizeInventoryKey(source.patternId || "none"),
    fontId: normalizeInventoryKey(source.fontId || "default"),
    equippedTitleId: normalizeInventoryKey(source.equippedTitleId || ""),
    titleColourId: normalizeInventoryKey(source.titleColourId || "rarity"),
    titleRgb: Boolean(source.titleRgb),
    titlePastel: Boolean(source.titlePastel)
  };
}

function normalizeInventoryUserId(value) {
  return String(value || "").trim().replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 140);
}

function normalizeInventoryKey(value) {
  return String(value || "").trim().replace(/[^a-zA-Z0-9_:.@/-]/g, "").slice(0, 180);
}

function normalizeInventoryOpId(value) {
  return String(value || "").trim().replace(/[^a-zA-Z0-9_:.@/-]/g, "").slice(0, 220);
}

function clampInventoryDelta(value) {
  return clampServerNumber(value, -1_000_000_000, 1_000_000_000, 0);
}

async function handleDebugQuestions(res) {
  const runtimeQuestionBank = await getRuntimeQuestionBank();
  const counts = Object.fromEntries(triviaThemes.map((theme) => [theme, {
    total: 0,
    image: 0,
    text: 0,
    multipleChoice: 0,
    easy: 0,
    medium: 0,
    hard: 0
  }]));

  runtimeQuestionBank.forEach((question) => {
    const bucket = counts[question.theme] || (counts[question.theme] = {
      total: 0,
      image: 0,
      text: 0,
      multipleChoice: 0,
      easy: 0,
      medium: 0,
      hard: 0
    });
    bucket.total += 1;
    bucket[question.type] = (bucket[question.type] || 0) + 1;
    if (question.questionStyle === "multiple-choice") {
      bucket.multipleChoice += 1;
    }
    bucket[question.difficulty] = (bucket[question.difficulty] || 0) + 1;
  });

  sendJson(res, 200, {
    total: runtimeQuestionBank.length,
    themes: triviaThemes,
    counts,
    questions: runtimeQuestionBank.map((question, index) => ({
      index,
      id: question.id,
      type: question.type,
      questionStyle: question.questionStyle || "standard",
      gradingStrictness: normalizeGradingStrictness(question.gradingStrictness),
      theme: question.theme,
      difficulty: question.difficulty,
      question: question.blackCard,
      image: question.image,
      canonicalAnswer: question.canonicalAnswer,
      acceptedAnswers: question.acceptedAnswers,
      botCards: question.botCards,
      multipleChoiceOptions: question.multipleChoiceOptions || [],
      rejectedAnswers: question.rejectedAnswers || []
    }))
  });
}

async function handleCreateDebugQuestion(req, res) {
  try {
    const body = await readRequestJson(req);
    const created = normalizeCreatedQuestion(body);
    const normalizedId = normalizeQuestionText(created.id);
    const runtimeQuestionBank = await getRuntimeQuestionBank();
    if (runtimeQuestionBank.some((question) => normalizeQuestionText(question.id) === normalizedId)) {
      sendJson(res, 409, { error: `Question id already exists: ${created.id}` });
      return;
    }

    const saved = await createRuntimeQuestion(created);
    sendJson(res, 201, saved);
  } catch (error) {
    sendJson(res, 400, { error: error.message || "Could not create question." });
  }
}

async function handleUpdateDebugQuestion(req, res, originalId) {
  try {
    const body = await readRequestJson(req);
    const updated = normalizeCreatedQuestion(body);
    const normalizedOriginalId = normalizeQuestionText(originalId);
    const runtimeQuestionBank = await getRuntimeQuestionBank();
    if (!runtimeQuestionBank.some((question) => normalizeQuestionText(question.id) === normalizedOriginalId)) {
      sendJson(res, 404, { error: `Question id not found: ${originalId}` });
      return;
    }

    const normalizedUpdatedId = normalizeQuestionText(updated.id);
    const duplicate = runtimeQuestionBank.some((question) => (
      normalizeQuestionText(question.id) !== normalizedOriginalId
      && normalizeQuestionText(question.id) === normalizedUpdatedId
    ));
    if (duplicate) {
      sendJson(res, 409, { error: `Question id already exists: ${updated.id}` });
      return;
    }

    const saved = await updateRuntimeQuestion(originalId, updated);
    sendJson(res, 200, saved);
  } catch (error) {
    sendJson(res, 400, { error: error.message || "Could not update question." });
  }
}

async function handleDeleteDebugQuestion(res, id) {
  try {
    const normalizedId = normalizeQuestionText(id);
    const runtimeQuestionBank = await getRuntimeQuestionBank();
    const existing = runtimeQuestionBank.find((question) => normalizeQuestionText(question.id) === normalizedId);
    if (!existing) {
      sendJson(res, 404, { error: `Question id not found: ${id}` });
      return;
    }

    const saved = await deleteRuntimeQuestion(id, existing);
    sendJson(res, 200, saved);
  } catch (error) {
    sendJson(res, 400, { error: error.message || "Could not delete question." });
  }
}

function isReadOnlyFileSystemError(error) {
  return ["EROFS", "EACCES", "EPERM"].includes(error?.code);
}

function assertQuestionFileWritesEnabled() {
  if (process.env.QUESTION_FILE_WRITES === "disabled") {
    const error = new Error("Question file writes are disabled.");
    error.code = "EROFS";
    throw error;
  }
}

function readQuestionFile() {
  const filePath = join(root, "data", "questions.json");
  const current = JSON.parse(readFileSync(filePath, "utf8"));
  if (!Array.isArray(current)) {
    throw new Error("Question bank is not an array.");
  }
  return current;
}

async function writeQuestionFile(questions) {
  assertQuestionFileWritesEnabled();
  const filePath = join(root, "data", "questions.json");
  await writeFile(filePath, `${JSON.stringify(questions, null, 2)}\n`);
}

function syncQuestionBankUpsert(question, originalId = question.id) {
  const normalized = normalizeSeedQuestion(question);
  if (!normalized) {
    return;
  }

  const normalizedOriginalId = normalizeQuestionText(originalId);
  const existingIndex = questionBank.findIndex((entry) => normalizeQuestionText(entry.id) === normalizedOriginalId);
  if (existingIndex >= 0) {
    questionBank[existingIndex] = normalized;
    return;
  }

  const normalizedId = normalizeQuestionText(question.id);
  const duplicateIndex = questionBank.findIndex((entry) => normalizeQuestionText(entry.id) === normalizedId);
  if (duplicateIndex >= 0) {
    questionBank[duplicateIndex] = normalized;
  } else {
    questionBank.push(normalized);
  }
}

function syncQuestionBankDelete(id) {
  const normalizedId = normalizeQuestionText(id);
  const index = questionBank.findIndex((entry) => normalizeQuestionText(entry.id) === normalizedId);
  if (index >= 0) {
    questionBank.splice(index, 1);
  }
}

async function upsertQuestionOverride(question) {
  await backendStore.upsertQuestionOverride({
    id: question.id,
    question,
    deleted: false,
    source: "debug"
  });
}

async function markQuestionOverrideDeleted(id) {
  await backendStore.upsertQuestionOverride({
    id,
    question: null,
    deleted: true,
    source: "debug"
  });
}

async function createRuntimeQuestion(question) {
  let fileSaved = false;
  try {
    const current = readQuestionFile();
    current.push(question);
    await writeQuestionFile(current);
    fileSaved = true;
    syncQuestionBankUpsert(question);
  } catch (error) {
    if (!isReadOnlyFileSystemError(error)) {
      throw error;
    }
    console.warn("Could not write created question to data/questions.json; saving it to persistent question overrides.", error.message || error);
  }

  if (!fileSaved) {
    await upsertQuestionOverride(question);
  }

  const runtimeQuestionBank = await getRuntimeQuestionBank();
  return { question, total: runtimeQuestionBank.length, fileSaved, storage: fileSaved ? "file" : "backend" };
}

async function updateRuntimeQuestion(originalId, question) {
  const normalizedOriginalId = normalizeQuestionText(originalId);
  let fileSaved = false;

  try {
    const current = readQuestionFile();
    const index = current.findIndex((entry) => normalizeQuestionText(entry.id) === normalizedOriginalId);
    if (index >= 0) {
      current[index] = question;
      await writeQuestionFile(current);
      fileSaved = true;
      syncQuestionBankUpsert(question, originalId);
    }
  } catch (error) {
    if (!isReadOnlyFileSystemError(error)) {
      throw error;
    }
    console.warn("Could not update data/questions.json; saving question edit to persistent overrides.", error.message || error);
  }

  if (!fileSaved) {
    if (normalizeQuestionText(originalId) !== normalizeQuestionText(question.id)) {
      await markQuestionOverrideDeleted(originalId);
    }
    await upsertQuestionOverride(question);
  }

  const runtimeQuestionBank = await getRuntimeQuestionBank();
  return { question, total: runtimeQuestionBank.length, fileSaved, storage: fileSaved ? "file" : "backend" };
}

async function deleteRuntimeQuestion(id, existingQuestion) {
  const normalizedId = normalizeQuestionText(id);
  let fileSaved = false;
  let deleted = existingQuestion;

  try {
    const current = readQuestionFile();
    const index = current.findIndex((entry) => normalizeQuestionText(entry.id) === normalizedId);
    if (index >= 0) {
      [deleted] = current.splice(index, 1);
      await writeQuestionFile(current);
      fileSaved = true;
      syncQuestionBankDelete(id);
    }
  } catch (error) {
    if (!isReadOnlyFileSystemError(error)) {
      throw error;
    }
    console.warn("Could not delete from data/questions.json; saving delete marker to persistent overrides.", error.message || error);
  }

  if (!fileSaved) {
    await markQuestionOverrideDeleted(id);
  }

  const runtimeQuestionBank = await getRuntimeQuestionBank();
  return { question: deleted, total: runtimeQuestionBank.length, fileSaved, storage: fileSaved ? "file" : "backend" };
}

function normalizeCreatedQuestion(body) {
  const source = body && typeof body === "object" ? body : {};
  const id = String(source.id || "").trim().slice(0, 120);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) {
    throw new Error("Use a lowercase kebab-case id.");
  }

  const theme = triviaThemes.includes(source.theme) ? source.theme : "";
  if (!theme) {
    throw new Error("Choose a valid theme.");
  }

  const difficulty = ["easy", "medium", "hard"].includes(source.difficulty) ? source.difficulty : "";
  if (!difficulty) {
    throw new Error("Choose easy, medium, or hard difficulty.");
  }

  const type = source.type === "image" ? "image" : "text";
  const questionStyle = source.questionStyle === "multiple-choice" || source.style === "multiple-choice" || source.type === "multiple-choice"
    ? "multiple-choice"
    : "standard";
  const gradingStrictness = normalizeGradingStrictness(source.gradingStrictness);
  const question = String(source.question || "").trim().replace(/\s+/g, " ").slice(0, 260);
  const canonicalAnswer = String(source.canonicalAnswer || "").trim().slice(0, 120);
  if (!question || !canonicalAnswer) {
    throw new Error("Question text and canonical answer are required.");
  }

  let acceptedAnswers = normalizeAnswerList(source.acceptedAnswers, 16);
  let botCards = normalizeAnswerList(source.botCards, questionStyle === "multiple-choice" ? 3 : 2);
  let multipleChoiceOptions = [];
  if (questionStyle === "multiple-choice") {
    const providedOptions = normalizeAnswerList(source.multipleChoiceOptions || source.options, 4);
    const incorrectAnswers = normalizeAnswerList(source.incorrectAnswers || source.wrongAnswers, 3);
    const wrongChoices = uniqueAnswers([
      ...providedOptions.filter((answer) => normalizeQuestionText(answer) !== normalizeQuestionText(canonicalAnswer)),
      ...incorrectAnswers,
      ...botCards
    ]).slice(0, 3);
    if (wrongChoices.length !== 3) {
      throw new Error("Multiple-choice questions need exactly three incorrect answers.");
    }
    multipleChoiceOptions = uniqueAnswers([canonicalAnswer, ...wrongChoices]).slice(0, 4);
    if (multipleChoiceOptions.length !== 4) {
      throw new Error("Multiple-choice questions need four unique options.");
    }
    acceptedAnswers = [];
    botCards = [];
  } else if (botCards.length !== 2) {
    throw new Error("Enter exactly two bot answers.");
  }

  const created = {
    id,
    type,
    questionStyle,
    gradingStrictness,
    theme,
    difficulty,
    question,
    canonicalAnswer,
    acceptedAnswers: uniqueAnswers(acceptedAnswers).slice(0, 16),
    botCards
  };
  if (questionStyle === "multiple-choice") {
    created.multipleChoiceOptions = multipleChoiceOptions;
  }

  const rejectedAnswers = normalizeAnswerList(source.rejectedAnswers, 12);
  if (rejectedAnswers.length) {
    created.rejectedAnswers = rejectedAnswers;
  }

  if (type === "image") {
    const image = source.image && typeof source.image === "object" ? source.image : {};
    const url = String(image.url || "").trim();
    if (!/^https:\/\/\S+$/i.test(url)) {
      throw new Error("Image questions need a valid https image URL.");
    }
    created.image = {
      url: url.slice(0, 600),
      alt: String(image.alt || "").trim().slice(0, 180),
      credit: String(image.credit || "").trim().slice(0, 120)
    };
  }

  return created;
}

function normalizeAnswerList(value, limit) {
  const raw = Array.isArray(value)
    ? value
    : String(value || "").split(",");
  return [...new Set(raw
    .map((entry) => String(entry || "").trim().slice(0, 120))
    .filter(Boolean))]
    .slice(0, limit);
}

function normalizeGradingStrictness(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return gradingStrictnessSet.has(normalized) ? normalized : "normal";
}

function getLocalGradingThreshold(strictness) {
  switch (normalizeGradingStrictness(strictness)) {
    case "forgiving":
      return 0.78;
    case "strict":
      return 0.9;
    case "exact":
      return 1;
    case "normal":
    default:
      return 0.82;
  }
}

function isExactAnswerMatch(answer, acceptedAnswers = []) {
  const normalizedAnswer = normalizeTriviaAnswer(answer);
  return Boolean(normalizedAnswer) && acceptedAnswers
    .map(normalizeTriviaAnswer)
    .filter(Boolean)
    .includes(normalizedAnswer);
}

function isAnswerCorrectByStrictness(answer, acceptedAnswers = [], strictness = "normal") {
  const normalizedStrictness = normalizeGradingStrictness(strictness);
  if (normalizedStrictness === "exact") {
    return isExactAnswerMatch(answer, acceptedAnswers);
  }
  return scoreAnswerAgainstBank(answer, acceptedAnswers) >= getLocalGradingThreshold(normalizedStrictness);
}

async function handleUpsertRoom(req, res) {
  try {
    const body = await readRequestJson(req, { maxBytes: roomRequestMaxBytes });
    const rawRoom = body.room || body;
    const existingRoom = await backendStore.getRoom(rawRoom.code);
    const authBody = { ...body, room: rawRoom, host: rawRoom.host };
    if (existingRoom && !requireRoomHostAuth(req, res, existingRoom, authBody, "Only the host can update this room.")) {
      return;
    }
    if (existingRoom) {
      if (!Array.isArray(rawRoom.chat)) {
        rawRoom.chat = existingRoom.chat || [];
      }
      if (!Object.hasOwn(rawRoom, "game")) {
        rawRoom.game = existingRoom.game || null;
      }
      if (!Array.isArray(rawRoom.participants)) {
        rawRoom.participants = existingRoom.participants || [];
      }
      if (!Array.isArray(rawRoom.banned)) {
        rawRoom.banned = existingRoom.banned || [];
      }
    }
    const room = normalizeRoom(rawRoom);
    const issueHostCookie = !existingRoom || !existingRoom.security?.hostToken;
    room.security = existingRoom?.security
      ? normalizeRoomSecurity(existingRoom.security)
      : createRoomSecurity();
    const recentClose = existingRoom ? null : await backendStore.getRoomClose(room.code);
    if (recentClose) {
      sendJson(res, 409, {
        error: "Room was recently closed.",
        closed: true,
        close: recentClose
      });
      return;
    }
    room.events = normalizeRoomEvents(existingRoom?.events);
    room.revision = clampServerNumber(existingRoom?.revision, 0, Number.MAX_SAFE_INTEGER, 0);
    const transferredRooms = await transferExistingHostRooms(room);
    stampRoomEvent(room, existingRoom ? "room_updated" : "room_created", { status: room.status });
    const storedRoom = await backendStore.upsertRoom(room);
    sendJson(res, 200, {
      room: sanitizeRoomForClient(storedRoom, { includePrivateSecrets: hasRoomHostAuth(req, storedRoom, authBody) || issueHostCookie }),
      transferredRooms: transferredRooms.map((entry) => sanitizeRoomForClient(entry))
    }, issueHostCookie ? { "Set-Cookie": createRoomHostCookie(req, storedRoom) } : {});
  } catch (error) {
    sendJson(res, 400, { error: error.message || "Room update failed." });
  }
}

function getRoomRevision(room) {
  return clampServerNumber(room?.revision, 0, Number.MAX_SAFE_INTEGER, 0);
}

function normalizeRoomEvents(events) {
  return (Array.isArray(events) ? events : [])
    .map((event) => ({
      id: String(event.id || "").slice(0, 120),
      revision: clampServerNumber(event.revision, 0, Number.MAX_SAFE_INTEGER, 0),
      type: String(event.type || "room_updated").slice(0, 60),
      payload: event.payload && typeof event.payload === "object" ? event.payload : {},
      createdAt: clampServerNumber(event.createdAt, 0, Number.MAX_SAFE_INTEGER, Date.now())
    }))
    .filter((event) => event.revision > 0 && event.type)
    .slice(-maxRoomEvents);
}

function sanitizeRoomEventForClient(event, options = {}) {
  const sanitized = {
    ...event,
    payload: event.payload && typeof event.payload === "object" ? { ...event.payload } : {}
  };
  if (sanitized.payload.participant && typeof sanitized.payload.participant === "object") {
    sanitized.payload.participant = sanitizeParticipantForClient(sanitized.payload.participant, options);
  }
  if (Array.isArray(sanitized.payload.submissions) && !options.includeSubmittedAnswers) {
    sanitized.payload.submissions = sanitized.payload.submissions.map((submission) => ({
      ...submission,
      answer: ""
    }));
  }
  if (sanitized.payload.settings && typeof sanitized.payload.settings === "object") {
    sanitized.payload.settings = sanitizeRoomSettingsForClient(sanitized.payload.settings, options);
  }
  if (sanitized.payload.room && typeof sanitized.payload.room === "object") {
    sanitized.payload.room = sanitizeRoomForClient(sanitized.payload.room, options);
  }
  if (sanitized.payload.game && typeof sanitized.payload.game === "object") {
    sanitized.payload.game = sanitizeRoomGameForClient(sanitized.payload.game, options);
  }
  if (!options.includePrivateSecrets) {
    delete sanitized.payload.hostToken;
    delete sanitized.payload.roomHostToken;
    delete sanitized.payload.participantToken;
    delete sanitized.payload.roomParticipantToken;
  }
  return sanitized;
}

function sanitizeRoomSettingsForClient(settings = {}, options = {}) {
  const sanitized = { ...(settings && typeof settings === "object" ? settings : {}) };
  const hasPassword = Boolean(String(sanitized.password || ""));
  sanitized.passwordRequired = Boolean(sanitized.private && hasPassword);
  delete sanitized.password;
  return sanitized;
}

function sanitizeRoomForClient(room, options = {}) {
  if (!room || typeof room !== "object") {
    return room;
  }

  const includeSubmittedAnswers = shouldExposeRoomAnswers(room, options);
  return {
    ...room,
    settings: sanitizeRoomSettingsForClient(room.settings, options),
    game: sanitizeRoomGameForClient(room.game, { ...options, includeSubmittedAnswers }),
    participants: (Array.isArray(room.participants) ? room.participants : [])
      .map((participant) => sanitizeParticipantForClient(participant, { ...options, includeSubmittedAnswers })),
    events: normalizeRoomEvents(room.events).map((event) => sanitizeRoomEventForClient(event, { ...options, includeSubmittedAnswers })),
    security: undefined,
    secrets: undefined,
    hostToken: undefined,
    roomHostToken: undefined,
    participantToken: undefined,
    roomParticipantToken: undefined
  };
}

function shouldExposeRoomAnswers(room, options = {}) {
  if (options.includeSubmittedAnswers === true || options.includePrivateSecrets === true) {
    return true;
  }
  const gameStatus = String(room?.game?.status || "").toLowerCase();
  const roomStatus = String(room?.status || "").toLowerCase();
  return gameStatus === "grading" || gameStatus === "ended" || roomStatus === "complete";
}

function sanitizeRoomGameForClient(game, options = {}) {
  if (!game || typeof game !== "object") {
    return game || null;
  }
  const sanitized = { ...game };
  if (sanitized.answers && typeof sanitized.answers === "object" && !options.includeSubmittedAnswers) {
    sanitized.answers = Object.fromEntries(
      Object.entries(sanitized.answers).map(([participantId, answerState]) => [
        participantId,
        {
          ...(answerState && typeof answerState === "object" ? answerState : {}),
          answer: ""
        }
      ])
    );
  }
  return sanitized;
}

function sanitizeParticipantForClient(participant, options = {}) {
  const sanitized = { ...(participant && typeof participant === "object" ? participant : {}) };
  delete sanitized.token;
  delete sanitized.participantToken;
  delete sanitized.roomParticipantToken;
  if (!options.includeSubmittedAnswers) {
    sanitized.answer = "";
  }
  return sanitized;
}

function createRoomSecurity() {
  return {
    hostToken: randomBytes(32).toString("base64url"),
    participantTokens: {},
    createdAt: Date.now()
  };
}

function normalizeRoomSecurity(security) {
  const source = security && typeof security === "object" ? security : {};
  const hostToken = String(source.hostToken || "").trim();
  if (!hostToken) {
    return createRoomSecurity();
  }
  return {
    hostToken,
    participantTokens: normalizeParticipantTokenMap(source.participantTokens),
    createdAt: clampServerNumber(source.createdAt, 0, Number.MAX_SAFE_INTEGER, Date.now())
  };
}

function normalizeParticipantTokenMap(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const entries = Object.entries(source)
    .map(([id, token]) => [String(id || "").slice(0, 80), String(token || "").trim()])
    .filter(([id, token]) => id && token);
  return Object.fromEntries(entries.slice(-20));
}

function getRoomHostCookieName(code) {
  return `${roomHostCookiePrefix}${String(code || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;
}

function getRoomParticipantCookieName(code, participantId) {
  const safeCode = String(code || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "_");
  const safeParticipantId = String(participantId || "").trim().replace(/[^a-zA-Z0-9]/g, "_").slice(0, 48);
  return `${roomParticipantCookiePrefix}${safeCode}_${safeParticipantId}`;
}

function getRequestRoomHostToken(req, room, body = {}) {
  return String(
    body.hostToken
    || body.roomHostToken
    || req?.headers?.["x-room-host-token"]
    || getCookie(req || { headers: {} }, getRoomHostCookieName(room?.code))
    || ""
  ).trim();
}

function hasRoomHostAuth(req, room, body = {}) {
  const security = room?.security;
  if (!security?.hostToken) {
    const hostParticipantId = body.hostParticipantId || body.participantId || body.host?.id || body.room?.host?.id;
    return isHostParticipant(room, hostParticipantId);
  }
  if (secureEqual(getRequestRoomHostToken(req, room, body), security.hostToken)) {
    return true;
  }
  const hostParticipantId = body.hostParticipantId
    || body.participantId
    || body.participant?.id
    || body.host?.id
    || body.room?.host?.id
    || room?.host?.id;
  return Boolean(isHostParticipant(room, hostParticipantId) && hasRoomParticipantTokenAuth(req, room, hostParticipantId, body));
}

function requireRoomHostAuth(req, res, room, body = {}, message = "Only the host can update this room.") {
  if (hasRoomHostAuth(req, room, body)) {
    return true;
  }
  sendJson(res, 403, { error: message });
  return false;
}

function getRequestRoomParticipantToken(req, room, participantId, body = {}) {
  return String(
    body.participantToken
    || body.roomParticipantToken
    || req?.headers?.["x-room-participant-token"]
    || getCookie(req || { headers: {} }, getRoomParticipantCookieName(room?.code, participantId))
    || ""
  ).trim();
}

function getStoredRoomParticipantToken(room, participantId) {
  const id = String(participantId || "").slice(0, 80);
  return String(room?.security?.participantTokens?.[id] || "").trim();
}

function hasRoomParticipantTokenAuth(req, room, participantId, body = {}) {
  const id = String(participantId || "").slice(0, 80);
  if (!id) {
    return false;
  }
  const storedToken = getStoredRoomParticipantToken(room, id);
  if (!storedToken) {
    return false;
  }
  return secureEqual(getRequestRoomParticipantToken(req, room, id, body), storedToken);
}

function ensureRoomParticipantToken(room, participantId) {
  const id = String(participantId || "").slice(0, 80);
  if (!id) {
    return "";
  }
  room.security = normalizeRoomSecurity(room.security);
  if (!room.security.participantTokens[id]) {
    room.security.participantTokens[id] = randomBytes(32).toString("base64url");
  }
  return room.security.participantTokens[id];
}

function pruneRoomParticipantTokens(room) {
  if (!room?.security?.participantTokens) {
    return;
  }
  const validIds = new Set((Array.isArray(room.participants) ? room.participants : []).map((participant) => participant.id).filter(Boolean));
  room.security.participantTokens = Object.fromEntries(
    Object.entries(room.security.participantTokens).filter(([id]) => validIds.has(id))
  );
}

function hasRoomParticipantAuth(req, room, participantId, body = {}) {
  const id = String(participantId || "").slice(0, 80);
  if (!id) {
    return false;
  }
  if (hasRoomHostAuth(req, room, body)) {
    return true;
  }
  return hasRoomParticipantTokenAuth(req, room, id, body);
}

function requireRoomParticipantAuth(req, res, room, participantId, body = {}, message = "Only this participant can update their room state.") {
  if (hasRoomParticipantAuth(req, room, participantId, body)) {
    return true;
  }
  sendJson(res, 403, { error: message });
  return false;
}

function createRoomHostCookie(req, room) {
  const token = room?.security?.hostToken;
  if (!room?.code || !token) {
    return "";
  }
  return serializeCookie(getRoomHostCookieName(room.code), token, {
    httpOnly: true,
    sameSite: "Strict",
    secure: isSecureRequest(req),
    path: "/",
    maxAge: roomHostSessionTtlSeconds
  });
}

function createRoomParticipantCookie(req, room, participantId) {
  const token = getStoredRoomParticipantToken(room, participantId);
  if (!room?.code || !participantId || !token) {
    return "";
  }
  return serializeCookie(getRoomParticipantCookieName(room.code, participantId), token, {
    httpOnly: true,
    sameSite: "Strict",
    secure: isSecureRequest(req),
    path: "/",
    maxAge: roomParticipantSessionTtlSeconds
  });
}

function stampRoomEvent(room, type, payload = {}) {
  const revision = getRoomRevision(room) + 1;
  room.revision = revision;
  room.updatedAt = Date.now();
  room.events = [
    ...normalizeRoomEvents(room.events),
    {
      id: `${room.code}-${revision}`,
      revision,
      type: String(type || "room_updated").slice(0, 60),
      payload: payload && typeof payload === "object" ? payload : {},
      createdAt: Date.now()
    }
  ].slice(-maxRoomEvents);
  return room;
}

const serverRoomEventClientTypeMap = {
  settings_updated: "room-settings"
};

function getClientRoomEventType(type = "") {
  const normalizedType = String(type || "room_updated");
  return serverRoomEventClientTypeMap[normalizedType] || normalizedType.replaceAll("_", "-");
}

function getRoomEventMatchId(room, extra = {}) {
  return String(
    extra.matchId
    || extra.game?.matchId
    || extra.roundResult?.matchId
    || extra.powerState?.matchId
    || room?.game?.matchId
    || ""
  ).slice(0, 80);
}

function getRoomEventRound(room, extra = {}) {
  return clampServerNumber(
    extra.round
    || extra.nextRound
    || extra.game?.round
    || extra.roundResult?.round
    || room?.game?.round,
    0,
    100,
    0
  );
}

function createRoomEventResponse(room, type = "room_updated", extra = {}) {
  const response = {
    code: room.code,
    status: room.status,
    revision: getRoomRevision(room),
    updatedAt: room.updatedAt,
    eventType: getClientRoomEventType(type),
    ...extra
  };
  const matchId = getRoomEventMatchId(room, response);
  const round = getRoomEventRound(room, response);
  if (matchId) {
    response.matchId = matchId;
  }
  if (round) {
    response.round = round;
  }
  return response;
}

function hasActiveRealPlayers(room) {
  return Array.isArray(room?.participants)
    && room.participants.some((participant) => {
      const role = normalizeParticipantRole(participant);
      return participant.active !== false && role !== "bot" && role !== "spectator";
    });
}

function getRoomActivePlayerCount(room) {
  if (Array.isArray(room?.participants) && room.participants.length) {
    return room.participants.filter(isGameplayParticipant).length;
  }
  return Number(room?.activePlayers || 0);
}

function createRoomClosePayload(code, reason) {
  return {
    code: String(code || "").trim().toUpperCase(),
    reason: String(reason || "closed").slice(0, 60),
    closedAt: Date.now()
  };
}

async function closeStoredRoom(code, reason) {
  const normalizedCode = String(code || "").trim().toUpperCase();
  await backendStore.upsertRoomClose(createRoomClosePayload(normalizedCode, reason));
  return backendStore.deleteRoom(normalizedCode);
}

function getRoomHostParticipant(room) {
  return Array.isArray(room?.participants)
    ? room.participants.find((participant) => participant.id === room.host?.id || normalizeParticipantRole(participant) === "host") || null
    : null;
}

function getRoomOwnerKey(room) {
  const hostParticipant = getRoomHostParticipant(room);
  const ownerKey = String(
    room?.host?.profileUserId
    || hostParticipant?.profileUserId
    || ""
  ).trim();
  return /^(user|guest):/.test(ownerKey) ? ownerKey : "";
}

function getParticipantJoinOrder(participant, index = 0) {
  return Number(participant?.joinedAt)
    || Number(participant?.lastConnectedAt)
    || Number(participant?.disconnectedAt)
    || index + 1;
}

function getHostTransferCandidate(room) {
  if (!Array.isArray(room?.participants)) {
    return null;
  }
  const currentHostId = String(room.host?.id || "").slice(0, 80);
  return room.participants
    .map((participant, index) => ({ participant, index }))
    .filter(({ participant }) => (
      participant
      && participant.id !== currentHostId
      && normalizeParticipantRole(participant) === "player"
      && participant.active !== false
    ))
    .sort((a, b) => getParticipantJoinOrder(a.participant, a.index) - getParticipantJoinOrder(b.participant, b.index) || a.index - b.index)[0]?.participant || null;
}

function getHostPayloadFromParticipant(participant) {
  return {
    id: participant.id,
    profileUserId: participant.profileUserId || participant.id,
    name: participant.name || "Host",
    avatar: participant.avatar || "",
    equippedTitleId: participant.equippedTitleId || "",
    specialBadges: normalizeSpecialBadges(participant.specialBadges),
    cardCustomization: participant.cardCustomization || null
  };
}

function rotateRoomHostToken(room) {
  room.security = normalizeRoomSecurity(room.security);
  room.security.hostToken = randomBytes(32).toString("base64url");
  room.security.createdAt = Date.now();
}

function transferRoomHostToOldestPlayer(room, reason = "host-transfer") {
  if (!room || room.status === "complete" || !Array.isArray(room.participants)) {
    return null;
  }
  const previousHost = getRoomHostParticipant(room) || room.host || null;
  const nextHost = getHostTransferCandidate(room);
  if (!nextHost) {
    return null;
  }
  room.participants.forEach((participant) => {
    const becomesHost = participant.id === nextHost.id;
    participant.host = becomesHost;
    participant.role = becomesHost
      ? "host"
      : participant.bot
        ? "bot"
        : participant.spectator
          ? "spectator"
          : "player";
    if (becomesHost) {
      participant.spectator = false;
      participant.bot = false;
      participant.active = true;
      participant.status = "host";
      participant.disconnectedAt = 0;
      participant.lastConnectedAt = participant.lastConnectedAt || Date.now();
    } else if (participant.id === previousHost?.id) {
      participant.host = false;
      if (reason === "host-created-another-room") {
        participant.active = false;
        participant.disconnectedAt = Date.now();
        participant.status = "left";
      } else {
        participant.status = participant.active === false ? "disconnected" : participant.status || "joined";
      }
    }
  });
  room.host = getHostPayloadFromParticipant(nextHost);
  room.hostExitPendingAt = 0;
  rotateRoomHostToken(room);
  finalizeRoom(room);
  stampRoomEvent(room, "host_transferred", {
    previousHostId: previousHost?.id || "",
    previousHostName: previousHost?.name || room.host?.name || "Host",
    newHostId: nextHost.id,
    newHostName: nextHost.name || "Host",
    reason: String(reason || "host-transfer").slice(0, 60),
    participant: nextHost,
    host: room.host
  });
  return room;
}

async function transferExistingHostRooms(nextRoom) {
  const ownerKey = getRoomOwnerKey(nextRoom);
  if (!ownerKey || nextRoom.status === "complete") {
    return [];
  }
  const rooms = await backendStore.listRooms();
  const transferred = [];
  await Promise.all(rooms.map(async (room) => {
    if (!room || room.code === nextRoom.code || room.status === "complete" || getRoomOwnerKey(room) !== ownerKey) {
      return;
    }
    const activeRoom = await ensureRoomReconnectGrace(room, { skipHostTransfer: true });
    if (!activeRoom) {
      return;
    }
    const promotedRoom = transferRoomHostToOldestPlayer(activeRoom, "host-created-another-room");
    if (!promotedRoom) {
      await closeStoredRoom(activeRoom.code, "host-created-another-room");
      return;
    }
    const storedRoom = await backendStore.upsertRoom(promotedRoom);
    transferred.push(storedRoom);
  }));
  return transferred;
}

function isRoomHostReconnectGraceExpired(room, now = Date.now()) {
  if (!room || room.status === "complete") {
    return false;
  }
  const hostParticipant = getRoomHostParticipant(room);
  const hostInactive = !hostParticipant || hostParticipant.active === false;
  const pendingAt = Number(room.hostExitPendingAt) || Number(hostParticipant?.disconnectedAt) || 0;
  return Boolean(hostInactive && pendingAt && now - pendingAt >= hostReconnectGraceMs);
}

function pruneExpiredDisconnectedParticipants(room, now = Date.now()) {
  if (!room || room.status === "complete" || !Array.isArray(room.participants)) {
    return [];
  }
  const removed = [];
  room.participants = room.participants.filter((participant) => {
    if (
      normalizeParticipantRole(participant) === "host"
      || normalizeParticipantRole(participant) === "bot"
      || participant.active !== false
      || !participant.disconnectedAt
      || now - Number(participant.disconnectedAt) < participantReconnectGraceMs
    ) {
      return true;
    }
    removed.push(participant);
    return false;
  });
  removed.forEach((participant) => {
    stampRoomEvent(room, "participant_left", {
      participantId: participant.id,
      participantName: participant.name || "A player",
      participant,
      reason: "disconnect-timeout"
    });
  });
  return removed;
}

async function ensureRoomReconnectGrace(room, options = {}) {
  if (!isRoomHostReconnectGraceExpired(room)) {
    const removed = pruneExpiredDisconnectedParticipants(room);
    if (removed.length) {
      finalizeRoom(room);
      return backendStore.upsertRoom(room);
    }
    return room;
  }
  if (!options.skipHostTransfer) {
    const promotedRoom = transferRoomHostToOldestPlayer(room, "host-reconnect-timeout");
    if (promotedRoom) {
      return backendStore.upsertRoom(promotedRoom);
    }
  }
  await closeStoredRoom(room.code, "host-disconnected");
  return null;
}

async function listRoomsForDirectory() {
  const rooms = await backendStore.listRooms();
  const checked = await Promise.all(rooms.map(ensureRoomReconnectGrace));
  return checked.filter(Boolean);
}

async function handleRoomPresence(req, res, code) {
  try {
    const normalizedCode = String(code || "").trim().toUpperCase();
    let room = await backendStore.getRoom(normalizedCode);
    if (!room) {
      sendJson(res, 404, { error: "Room not found." });
      return;
    }
    room = await ensureRoomReconnectGrace(room);
    if (!room) {
      sendJson(res, 410, { closed: true, close: createRoomClosePayload(normalizedCode, "host-disconnected") });
      return;
    }

    const body = await readRequestJson(req, { maxBytes: roomRequestMaxBytes });
    const rawParticipant = body.participant || {};
    const participant = normalizeParticipant(rawParticipant);
    let existingIndex = room.participants.findIndex((entry) => entry.id === participant.id);
    const sameProfileIndex = participant.profileUserId && normalizeParticipantRole(participant) !== "bot"
      ? room.participants.findIndex((entry) => (
        entry.id !== participant.id
        && normalizeParticipantRole(entry) !== "bot"
        && String(entry.profileUserId || "") === participant.profileUserId
      ))
      : -1;
    const sameProfileParticipant = sameProfileIndex >= 0 ? room.participants[sameProfileIndex] : null;
    if (
      sameProfileParticipant
      && sameProfileParticipant.active !== false
      && participant.active !== false
    ) {
      sendJson(res, 409, { error: "This profile is already in the room.", duplicateParticipantId: sameProfileParticipant.id });
      return;
    }
    const reclaimingInactiveProfile = existingIndex < 0 && sameProfileParticipant?.active === false && participant.active !== false;
    if (reclaimingInactiveProfile) {
      existingIndex = sameProfileIndex;
    }
    const hostAuthenticated = hasRoomHostAuth(req, room, body);
    if (reclaimingInactiveProfile && normalizeParticipantRole(sameProfileParticipant) === "host" && (normalizeParticipantRole(participant) !== "host" || !hostAuthenticated)) {
      sendJson(res, 403, { error: "Only the host can reclaim the host slot." });
      return;
    }
    const existingParticipantForAuth = existingIndex >= 0 ? room.participants[existingIndex] : null;
    const reclaimingKickedParticipant = Boolean(
      existingParticipantForAuth
      && existingParticipantForAuth.active === false
      && String(existingParticipantForAuth.status || "") === "kicked"
      && participant.active !== false
      && normalizeParticipantRole(existingParticipantForAuth) === "player"
      && String(existingParticipantForAuth.profileUserId || "") === String(participant.profileUserId || "")
    );
    const isHostIdentity = participant.id === room.host?.id || normalizeParticipantRole(participant) === "host";
    if (isHostIdentity && !hostAuthenticated) {
      sendJson(res, 403, { error: "Only the host can update the host participant." });
      return;
    }
    if (normalizeParticipantRole(participant) === "bot" && !hostAuthenticated) {
      sendJson(res, 403, { error: "Only the host can update bot participants." });
      return;
    }
    if (existingIndex >= 0 && !reclaimingInactiveProfile && !reclaimingKickedParticipant && !hostAuthenticated && !hasRoomParticipantAuth(req, room, participant.id, body)) {
      sendJson(res, 403, { error: "Only this participant can update their room state." });
      return;
    }
    if (room.banned?.includes(participant.id) || room.banned?.includes(participant.name) || room.banned?.includes(participant.profileUserId)) {
      sendJson(res, 403, { error: "This participant is banned from the room." });
      return;
    }
    if (room.settings?.private && existingIndex < 0 && !hostAuthenticated) {
      const password = String(body.password || body.roomPassword || "").trim();
      if (!secureEqual(password, room.settings.password || "")) {
        sendJson(res, 403, { error: "Invalid room password." });
        return;
      }
    }
    if (existingIndex < 0 && isGameplayParticipant(participant)) {
      const activePlayers = room.participants.filter(isGameplayParticipant).length;
      if (activePlayers >= room.settings.maxPlayers) {
        sendJson(res, 409, { error: "Room is full." });
        return;
      }
    }
    const currentMatchId = String(room.game?.matchId || "").slice(0, 80);
    const currentRound = clampServerNumber(room.game?.round, 0, 100, 0);
    const submissionMatchId = String(participant.submissionMatchId || "").slice(0, 80);
    const submissionRound = clampServerNumber(participant.submittedRound, 0, 100, 0);
    const hasSubmissionUpdate = Object.hasOwn(rawParticipant, "answer")
      || Object.hasOwn(rawParticipant, "submittedRound")
      || Object.hasOwn(rawParticipant, "remainingTime");
    const existingParticipant = existingIndex >= 0 ? room.participants[existingIndex] : null;
    if (
      normalizeParticipantRole(existingParticipant) === "spectator"
      && room.status === "in-progress"
      && !hostAuthenticated
      && normalizeParticipantRole(participant) !== "spectator"
    ) {
      participant.role = "spectator";
      participant.host = false;
      participant.bot = false;
      participant.spectator = true;
      participant.status = String(existingParticipant.status || getParticipantDefaultStatus("spectator")).slice(0, 32);
    }
    if (hasSubmissionUpdate && (normalizeParticipantRole(participant) === "spectator" || normalizeParticipantRole(existingParticipant) === "spectator")) {
      sendJson(res, 403, { error: "Spectators cannot submit gameplay answers." });
      return;
    }
    const acceptsSubmissionUpdate = !hasSubmissionUpdate
      || (
        (!currentMatchId || (submissionMatchId && submissionMatchId === currentMatchId))
        && (!currentRound || (submissionRound && submissionRound === currentRound))
      );
    const wasActive = existingParticipant ? existingParticipant.active !== false : false;
    const isNowActive = participant.active !== false;
    const staleDisconnectForNewConnection = Boolean(
      existingParticipant
      && !isNowActive
      && existingParticipant.active !== false
      && existingParticipant.connectionId
      && participant.connectionId
      && existingParticipant.connectionId !== participant.connectionId
    );
    if (staleDisconnectForNewConnection) {
      const storedParticipant = existingParticipant;
      sendJson(res, 200, {
        code: room.code,
        status: room.status,
        revision: getRoomRevision(room),
        updatedAt: room.updatedAt,
        eventType: "participant_updated",
        participant: sanitizeParticipantForClient(storedParticipant, { includeSubmittedAnswers: true })
      });
      return;
    }
    if (existingIndex >= 0) {
      const nextRole = participant.role || normalizeParticipantRole(participant);
      room.participants[existingIndex] = {
        ...existingParticipant,
        ...participant,
        role: nextRole,
        host: nextRole === "host",
        bot: nextRole === "bot",
        spectator: nextRole === "spectator",
        joinedAt: existingParticipant.joinedAt || participant.joinedAt || existingParticipant.lastConnectedAt || Date.now(),
        disconnectedAt: isNowActive ? 0 : Date.now(),
        lastConnectedAt: isNowActive ? Date.now() : existingParticipant.lastConnectedAt || 0,
        status: hasSubmissionUpdate && !acceptsSubmissionUpdate ? existingParticipant.status : participant.status,
        answer: acceptsSubmissionUpdate && Object.hasOwn(rawParticipant, "answer") ? participant.answer : existingParticipant.answer,
        submittedRound: acceptsSubmissionUpdate && Object.hasOwn(rawParticipant, "submittedRound") ? participant.submittedRound : existingParticipant.submittedRound,
        submissionMatchId: acceptsSubmissionUpdate && Object.hasOwn(rawParticipant, "submittedRound") ? participant.submissionMatchId : existingParticipant.submissionMatchId || "",
        remainingTime: acceptsSubmissionUpdate && Object.hasOwn(rawParticipant, "remainingTime") ? participant.remainingTime : existingParticipant.remainingTime
      };
    } else {
      if (hasSubmissionUpdate && !acceptsSubmissionUpdate) {
        participant.answer = "";
        participant.submittedRound = 0;
        participant.submissionMatchId = "";
        participant.remainingTime = 0;
        participant.status = getParticipantDefaultStatus(participant.role);
      }
      participant.disconnectedAt = participant.active === false ? Date.now() : 0;
      participant.lastConnectedAt = participant.active === false ? 0 : Date.now();
      participant.joinedAt = participant.joinedAt || Date.now();
      room.participants.push(participant);
    }

    if (normalizeParticipantRole(participant) === "host") {
      room.host = {
        ...(room.host || {}),
        id: participant.id,
        profileUserId: participant.profileUserId || participant.id,
        name: participant.name,
        avatar: participant.avatar,
        equippedTitleId: participant.equippedTitleId || "",
        specialBadges: normalizeSpecialBadges(participant.specialBadges),
        cardCustomization: participant.cardCustomization || null
      };
    }
    const storedParticipant = room.participants[existingIndex >= 0 ? existingIndex : room.participants.length - 1] || participant;
    if (storedParticipant.host || storedParticipant.id === room.host?.id) {
      room.hostExitPendingAt = storedParticipant.active === false ? Date.now() : 0;
    }
    if (normalizeParticipantRole(participant) !== "bot") {
      ensureRoomParticipantToken(room, participant.id);
    }
    finalizeRoom(room);
    const finalParticipant = room.participants.find((entry) => entry.id === participant.id) || storedParticipant || participant;
    const participantEventType = existingIndex >= 0
      ? !isNowActive
        ? "participant_disconnected"
        : !wasActive
          ? "participant_reconnected"
          : "participant_updated"
      : "participant_joined";
    const answerSubmitted = Boolean(
      hasSubmissionUpdate
      && acceptsSubmissionUpdate
      && Number(finalParticipant.submittedRound) > 0
      && String(finalParticipant.status || "") === "submitted"
    );
    const eventType = answerSubmitted ? "answer_submitted" : participantEventType;
    const eventPayload = {
      participantId: finalParticipant.id,
      participantName: finalParticipant.name || "A player",
      role: normalizeParticipantRole(finalParticipant),
      host: Boolean(finalParticipant.host),
      spectator: Boolean(finalParticipant.spectator),
      status: finalParticipant.status,
      participant: finalParticipant
    };
    if (answerSubmitted) {
      eventPayload.matchId = String(finalParticipant.submissionMatchId || currentMatchId || "").slice(0, 80);
      eventPayload.round = clampServerNumber(finalParticipant.submittedRound, 1, 100, room.game?.round || 1);
      eventPayload.answer = String(finalParticipant.answer || "").slice(0, 500);
      eventPayload.remainingTime = clampServerNumber(finalParticipant.remainingTime, 0, 600, 0);
    }
    stampRoomEvent(room, eventType, eventPayload);
    const storedRoom = await backendStore.upsertRoom(room);
    const participantCookie = normalizeParticipantRole(participant) !== "bot" ? createRoomParticipantCookie(req, storedRoom, participant.id) : "";
    if (body.compact) {
      const storedParticipant = storedRoom.participants.find((entry) => entry.id === participant.id) || participant;
      const compactResponse = createRoomEventResponse(storedRoom, eventType, {
        ...eventPayload,
        participant: sanitizeParticipantForClient(storedParticipant, { includeSubmittedAnswers: true }),
        answer: answerSubmitted ? String(storedParticipant.answer || "").slice(0, 500) : undefined,
        remainingTime: answerSubmitted ? clampServerNumber(storedParticipant.remainingTime, 0, 600, 0) : undefined
      });
      if (body.includeRoom || body.includeRoomSnapshot) {
        compactResponse.room = sanitizeRoomForClient(storedRoom, { includePrivateSecrets: hostAuthenticated });
      }
      sendJson(res, 200, compactResponse, participantCookie ? { "Set-Cookie": participantCookie } : {});
      return;
    }
    sendJson(res, 200, {
      room: sanitizeRoomForClient(storedRoom, { includePrivateSecrets: hostAuthenticated })
    }, participantCookie ? { "Set-Cookie": participantCookie } : {});
  } catch (error) {
    sendJson(res, 400, { error: error.message || "Room presence update failed." });
  }
}

async function handleRoomSettings(req, res, code) {
  try {
    const normalizedCode = String(code || "").trim().toUpperCase();
    const room = await backendStore.getRoom(normalizedCode);
    if (!room) {
      sendJson(res, 404, { error: "Room not found." });
      return;
    }

    const body = await readRequestJson(req, { maxBytes: roomRequestMaxBytes });
    if (!requireRoomHostAuth(req, res, room, body, "Only the host can update room settings.")) {
      return;
    }
    const nextSettings = normalizeRoomSettings({
      ...(room.settings || {}),
      ...(body.settings && typeof body.settings === "object" ? body.settings : body)
    }, normalizedCode);
    const nextStatus = ["draft", "lobby", "in-progress", "complete"].includes(body.status)
      ? body.status
      : room.status;
    room.settings = nextSettings;
    room.status = nextStatus;
    if (body.host && typeof body.host === "object") {
      room.host = {
        ...(room.host || {}),
        id: String(body.host.id || room.host?.id || "host").slice(0, 80),
        profileUserId: String(body.host.profileUserId || room.host?.profileUserId || body.host.userId || room.host?.id || "host").slice(0, 140),
        name: String(body.host.name || room.host?.name || "Host").slice(0, 24),
        avatar: String(body.host.avatar || room.host?.avatar || "").slice(0, 60000),
        equippedTitleId: String(body.host.equippedTitleId || room.host?.equippedTitleId || "").slice(0, 80),
        specialBadges: normalizeSpecialBadges(body.host.specialBadges || room.host?.specialBadges),
        cardCustomization: normalizeCardCustomization(body.host.cardCustomization || room.host?.cardCustomization)
      };
      const hostParticipant = room.participants.find((participant) => participant.id === room.host.id || normalizeParticipantRole(participant) === "host");
      if (hostParticipant) {
        hostParticipant.name = room.host.name;
        hostParticipant.profileUserId = room.host.profileUserId || hostParticipant.profileUserId || hostParticipant.id;
        hostParticipant.avatar = room.host.avatar;
        hostParticipant.equippedTitleId = room.host.equippedTitleId || "";
        hostParticipant.specialBadges = normalizeSpecialBadges(room.host.specialBadges);
        hostParticipant.cardCustomization = room.host.cardCustomization || null;
        hostParticipant.host = true;
      }
    }
    finalizeRoom(room);
    stampRoomEvent(room, "settings_updated", {
      status: room.status,
      settings: room.settings,
      host: room.host
    });
    const storedRoom = await backendStore.upsertRoom(room);
    sendJson(res, 200, createRoomEventResponse(storedRoom, "settings_updated", {
      settings: sanitizeRoomSettingsForClient(storedRoom.settings, { includePrivateSecrets: true }),
      host: storedRoom.host
    }));
  } catch (error) {
    sendJson(res, 400, { error: error.message || "Room settings update failed." });
  }
}

async function handleRoomHeartbeat(req, res, code) {
  try {
    const normalizedCode = String(code || "").trim().toUpperCase();
    let room = await backendStore.getRoom(normalizedCode);
    if (!room) {
      sendJson(res, 404, { error: "Room not found." });
      return;
    }
    room = await ensureRoomReconnectGrace(room);
    if (!room) {
      sendJson(res, 410, { closed: true, close: createRoomClosePayload(normalizedCode, "host-disconnected") });
      return;
    }

    const body = await readRequestJson(req);
    const participantId = String(body.participantId || "").slice(0, 80);
    if (!requireRoomHostAuth(req, res, room, body, "Only the host can heartbeat this room.")) {
      return;
    }
    const participant = room.participants.find((entry) => entry.id === participantId);

    room.hostExitPendingAt = 0;
    if (participant) {
      const wasActive = participant.active !== false;
      participant.active = true;
      participant.status = String(body.status || participant.status || "host").slice(0, 32);
      participant.disconnectedAt = 0;
      participant.lastConnectedAt = Date.now();
      if (!wasActive) {
        stampRoomEvent(room, "participant_reconnected", {
          participantId: participant.id,
          participantName: participant.name || "Host",
          role: normalizeParticipantRole(participant),
          host: Boolean(participant.host),
          spectator: Boolean(participant.spectator),
          status: participant.status,
          participant
        });
      }
    }
    finalizeRoom(room);
    room.updatedAt = Date.now();
    const storedRoom = await backendStore.upsertRoom(room);
    sendJson(res, 200, {
      room: sanitizeRoomForClient(storedRoom, { includePrivateSecrets: true })
    });
  } catch (error) {
    sendJson(res, 400, { error: error.message || "Room heartbeat failed." });
  }
}

async function handleRoomChat(req, res, code) {
  try {
    const normalizedCode = String(code || "").trim().toUpperCase();
    const room = await backendStore.getRoom(normalizedCode);
    if (!room) {
      sendJson(res, 404, { error: "Room not found." });
      return;
    }

    const body = await readRequestJson(req, { maxBytes: roomRequestMaxBytes });
    const [message] = normalizeRoomChat([body.message || body]);
    if (!message) {
      sendJson(res, 400, { error: "Chat message is empty." });
      return;
    }
    const participantId = message.participantId || String(body.participantId || "").slice(0, 80);
    if (!participantId) {
      sendJson(res, 400, { error: "Missing participant id." });
      return;
    }
    if (!requireRoomParticipantAuth(req, res, room, participantId, body, "Only this participant can send chat messages.")) {
      return;
    }
    const participant = room.participants.find((entry) => entry.id === participantId);
    if (!participant || participant.active === false || participant.muted) {
      sendJson(res, 403, { error: participant?.muted ? "You are muted." : "Participant is not active." });
      return;
    }
    const cooldown = checkServerChatCooldown(req, normalizedCode, participantId);
    if (!cooldown.ok) {
      sendJson(res, 429, { error: "Chat cooldown active.", retryAfterMs: cooldown.retryAfterMs }, {
        "Retry-After": String(Math.max(1, Math.ceil(cooldown.retryAfterMs / 1000)))
      });
      return;
    }
    message.participantId = participantId;
    message.spectator = Boolean(participant.spectator);
    message.host = Boolean(participant.host || participant.id === room.host?.id);
    room.chat = normalizeRoomChat([...(Array.isArray(room.chat) ? room.chat : []), message]);
    stampRoomEvent(room, "chat_message", {
      owner: message.owner,
      sender: message.sender,
      participantId,
      private: Boolean(message.private),
      message
    });
    finalizeRoom(room);
    const storedRoom = await backendStore.upsertRoom(room);
    if (body.compact) {
      sendJson(res, 200, createRoomEventResponse(storedRoom, "chat_message", {
        message
      }));
      return;
    }
    sendJson(res, 200, { room: sanitizeRoomForClient(storedRoom), message });
  } catch (error) {
    sendJson(res, 400, { error: error.message || "Room chat update failed." });
  }
}

async function handleRoomGame(req, res, code) {
  try {
    const normalizedCode = String(code || "").trim().toUpperCase();
    const room = await backendStore.getRoom(normalizedCode);
    if (!room) {
      sendJson(res, 404, { error: "Room not found." });
      return;
    }

    const body = await readRequestJson(req, { maxBytes: roomRequestMaxBytes });
    if (!requireRoomHostAuth(req, res, room, body, "Only the host can update room game state.")) {
      return;
    }
    const game = normalizeRoomGame(body.game || body);
    if (!game || (!game.setup && game.status !== "ended")) {
      sendJson(res, 400, { error: "Room game update needs a setup payload." });
      return;
    }
    const currentMatchId = String(room.game?.matchId || "").slice(0, 80);
    const currentRound = clampServerNumber(room.game?.round, 0, 100, 0);
    const payloadMatchId = String(game.matchId || "").slice(0, 80);
    const roomIsActiveMatch = room.status === "in-progress" && room.game?.status !== "ended";
    if (roomIsActiveMatch && currentMatchId && payloadMatchId && payloadMatchId !== currentMatchId) {
      sendJson(res, 409, { error: game.status === "ended" ? "Game end belongs to a previous match." : "Round setup belongs to a previous match." });
      return;
    }
    if (room.game?.status === "ended" && game.status !== "ended" && currentMatchId && payloadMatchId === currentMatchId) {
      sendJson(res, 409, { error: "Round setup belongs to a completed match." });
      return;
    }
    if (roomIsActiveMatch && currentRound && game.round < currentRound) {
      sendJson(res, 409, { error: game.status === "ended" ? "Game end belongs to a previous round." : "Round setup belongs to a previous round." });
      return;
    }
    if (
      game.status !== "ended"
      && roomIsActiveMatch
      && currentRound
      && game.round === currentRound
      && (room.game?.roundResult || room.game?.status === "grading" || room.game?.status === "ended")
    ) {
      sendJson(res, 409, { error: "Round setup cannot overwrite a completed round." });
      return;
    }
    room.status = game.status === "ended" ? "complete" : "in-progress";
    room.game = game;
    if (game.status === "ended") {
      stampRoomEvent(room, "game_ended", {
        round: game.round,
        matchId: game.matchId,
        game
      });
    } else {
      stampRoomEvent(room, "round_started", {
        round: game.round,
        matchId: game.matchId,
        game
      });
    }
    finalizeRoom(room);
    const storedRoom = await backendStore.upsertRoom(room);
    sendJson(res, 200, {
      room: sanitizeRoomForClient(storedRoom, { includePrivateSecrets: true })
    });
  } catch (error) {
    sendJson(res, 400, { error: error.message || "Room game update failed." });
  }
}

function clearParticipantMatchState(participant = {}) {
  const role = normalizeParticipantRole(participant);
  const active = participant.active !== false;
  return {
    ...participant,
    answer: "",
    submittedRound: 0,
    submissionMatchId: "",
    remainingTime: 0,
    status: active ? getParticipantDefaultStatus(role) : String(participant.status || getParticipantDefaultStatus(role)).slice(0, 32)
  };
}

async function handleRoomReturnToLobby(req, res, code) {
  try {
    const normalizedCode = String(code || "").trim().toUpperCase();
    const room = await backendStore.getRoom(normalizedCode);
    if (!room) {
      sendJson(res, 404, { error: "Room not found." });
      return;
    }

    const body = await readRequestJson(req, { maxBytes: roomRequestMaxBytes });
    if (!requireRoomHostAuth(req, res, room, body, "Only the host can return the room to lobby.")) {
      return;
    }

    const currentMatchId = String(room.game?.matchId || "").slice(0, 80);
    const payloadMatchId = String(body.matchId || body.game?.matchId || "").slice(0, 80);
    if (currentMatchId && payloadMatchId && payloadMatchId !== currentMatchId) {
      sendJson(res, 409, { error: "Lobby return belongs to a previous match." });
      return;
    }

    room.status = "lobby";
    room.game = null;
    room.participants = (Array.isArray(room.participants) ? room.participants : [])
      .map(clearParticipantMatchState)
      .map(normalizeParticipant);
    room.hostExitPendingAt = 0;
    finalizeRoom(room);
    const lobbySnapshot = sanitizeRoomForClient({ ...room, events: [] }, { includePrivateSecrets: true });
    stampRoomEvent(room, "room_updated", {
      status: "lobby",
      previousMatchId: currentMatchId,
      room: lobbySnapshot,
      game: null
    });
    const storedRoom = await backendStore.upsertRoom(room);
    sendJson(res, 200, createRoomEventResponse(storedRoom, "room_updated", {
      previousMatchId: currentMatchId,
      room: sanitizeRoomForClient(storedRoom, { includePrivateSecrets: true }),
      game: null
    }));
  } catch (error) {
    sendJson(res, 400, { error: error.message || "Return to lobby failed." });
  }
}

async function handleRoomRoundAdvancing(req, res, code) {
  try {
    const normalizedCode = String(code || "").trim().toUpperCase();
    const room = await backendStore.getRoom(normalizedCode);
    if (!room) {
      sendJson(res, 404, { error: "Room not found." });
      return;
    }

    const body = await readRequestJson(req, { maxBytes: roomRequestMaxBytes });
    const hostParticipantId = String(body.hostParticipantId || "").slice(0, 80);
    if (!requireRoomHostAuth(req, res, room, body, "Only the host can advance the room round.")) {
      return;
    }

    const currentGame = room.game && typeof room.game === "object" ? room.game : null;
    const currentMatchId = String(currentGame?.matchId || "").slice(0, 80);
    const payloadMatchId = String(body.matchId || body.game?.matchId || "").slice(0, 80);
    const matchId = payloadMatchId || currentMatchId || `${normalizedCode}-${Date.now()}`;
    const currentRound = clampServerNumber(currentGame?.round, 0, 100, 0);
    const round = clampServerNumber(body.round || body.nextRound, 1, 100, currentRound || 1);
    const roomIsActiveMatch = room.status === "in-progress" && currentGame && currentGame.status !== "ended";
    if (roomIsActiveMatch && currentMatchId && payloadMatchId && payloadMatchId !== currentMatchId) {
      sendJson(res, 409, { error: "Round advance belongs to a previous match." });
      return;
    }
    if (roomIsActiveMatch && currentRound && round < currentRound) {
      sendJson(res, 409, { error: "Round advance belongs to a previous round." });
      return;
    }
    if (
      roomIsActiveMatch
      && currentRound
      && round === currentRound
      && currentGame.setup
      && currentGame.status !== "starting"
    ) {
      sendJson(res, 200, createRoomEventResponse(room, "round_advancing", {
        duplicate: true,
        round,
        matchId: currentMatchId || matchId,
        matchSettings: currentGame.matchSettings || normalizeRoomGameSettings(room.settings),
        game: currentGame
      }));
      return;
    }

    const matchSettings = normalizeRoomGameSettings(body.matchSettings || body.settings || currentGame?.matchSettings || room.settings);
    room.status = "in-progress";
    room.settings = normalizeRoomSettings({
      ...(room.settings || {}),
      ...matchSettings,
      randomModifiers: false,
      code: normalizedCode
    }, normalizedCode);
    room.game = normalizeRoomGame({
      ...(currentMatchId === matchId ? currentGame || {} : {}),
      matchId,
      status: "starting",
      round,
      setup: null,
      answers: {},
      matchSettings,
      roundResult: null,
      powerState: currentMatchId === matchId ? currentGame?.powerState || null : null,
      setupStartedAt: Date.now(),
      roundStartedAt: 0,
      updatedAt: Date.now()
    });
    stampRoomEvent(room, "round_advancing", {
      round,
      matchId,
      hostParticipantId,
      matchSettings,
      game: room.game
    });
    finalizeRoom(room);
    const storedRoom = await backendStore.upsertRoom(room);
    sendJson(res, 200, createRoomEventResponse(storedRoom, "round_advancing", {
      round: storedRoom.game?.round || round,
      matchId: storedRoom.game?.matchId || matchId,
      hostParticipantId,
      matchSettings: storedRoom.game?.matchSettings || matchSettings,
      game: storedRoom.game || room.game
    }));
  } catch (error) {
    sendJson(res, 400, { error: error.message || "Round advance failed." });
  }
}

async function handleRoomRoundSetup(req, res, code) {
  try {
    const normalizedCode = String(code || "").trim().toUpperCase();
    const room = await backendStore.getRoom(normalizedCode);
    if (!room) {
      sendJson(res, 404, { error: "Room not found." });
      return;
    }

    const body = await readRequestJson(req, { maxBytes: roomRequestMaxBytes });
    if (!requireRoomHostAuth(req, res, room, body, "Only the host can prepare a room round.")) {
      return;
    }

    const currentGame = room.game && typeof room.game === "object" ? room.game : null;
    const currentMatchId = String(currentGame?.matchId || "").slice(0, 80);
    const payloadMatchId = String(body.matchId || body.game?.matchId || "").slice(0, 80);
    const matchId = payloadMatchId || currentMatchId || `${normalizedCode}-${Date.now()}`;
    const currentRound = clampServerNumber(currentGame?.round, 0, 100, 0);
    const round = clampServerNumber(body.round || currentRound, 1, 100, currentRound || 1);

    if (room.status !== "in-progress" || !currentGame) {
      sendJson(res, 409, { error: "Round setup needs a round preparation state first." });
      return;
    }
    if (currentMatchId && payloadMatchId && payloadMatchId !== currentMatchId) {
      sendJson(res, 409, { error: "Round setup belongs to a previous match." });
      return;
    }
    if (currentRound && round < currentRound) {
      sendJson(res, 409, { error: "Round setup belongs to a previous round." });
      return;
    }
    if (currentRound && round > currentRound) {
      sendJson(res, 409, { error: "Round setup cannot skip the prepared round." });
      return;
    }
    if (currentGame.setup && currentGame.status !== "starting") {
      sendJson(res, 200, createRoomEventResponse(room, "round_started", {
        duplicate: true,
        round: currentRound || round,
        matchId: currentMatchId || matchId,
        game: currentGame,
        room: sanitizeRoomForClient(room, { includePrivateSecrets: true })
      }));
      return;
    }

    const matchSettings = normalizeRoomGameSettings(body.matchSettings || body.settings || currentGame.matchSettings || room.settings);
    const enabledThemes = normalizeEnabledThemes(body.enabledThemes || matchSettings.enabledThemes || room.settings?.enabledThemes);
    const preferredTheme = normalizePreferredTheme(body.preferredTheme, enabledThemes);
    const recentBlackCards = Array.isArray(body.recentBlackCards) ? body.recentBlackCards.map(String).slice(-30) : [];
    const totalRounds = clampServerNumber(body.totalRounds || matchSettings.rounds || room.settings?.rounds, 1, 100, matchSettings.rounds || 10);
    const setupSeed = String(body.setupSeed || `${Date.now()}-${Math.random()}`).slice(0, 80);
    const setup = await getSeedQuestionSetup({
      recentBlackCards,
      enabledThemes,
      preferredTheme,
      setupSeed,
      backgroundMode: false,
      round,
      totalRounds
    });
    if (!setup) {
      throw new Error("No seed questions are available for the selected themes.");
    }

    const now = Date.now();
    const timerState = createRoomTimerState(room, matchSettings, now);
    room.status = "in-progress";
    room.game = normalizeRoomGame({
      ...(currentMatchId === matchId ? currentGame : {}),
      matchId,
      status: "playing",
      round,
      setup,
      answers: {},
      matchSettings,
      roundResult: null,
      powerState: body.powerState || currentGame.powerState || null,
      setupStartedAt: currentGame.setupStartedAt || now,
      roundStartedAt: now,
      baseDurationMs: timerState.baseDurationMs,
      participantTimers: timerState.participantTimers,
      gradingForceAt: timerState.gradingForceAt,
      updatedAt: now
    });
    stampRoomEvent(room, "round_started", {
      round,
      matchId,
      game: room.game
    });
    finalizeRoom(room);
    const storedRoom = await backendStore.upsertRoom(room);
    sendJson(res, 200, createRoomEventResponse(storedRoom, "round_started", {
      round: storedRoom.game?.round || round,
      matchId: storedRoom.game?.matchId || matchId,
      game: storedRoom.game || room.game,
      room: sanitizeRoomForClient(storedRoom, { includePrivateSecrets: true })
    }));
  } catch (error) {
    sendJson(res, 400, { error: error.message || "Round setup generation failed." });
  }
}

async function handleRoomAnswer(req, res, code) {
  try {
    const normalizedCode = String(code || "").trim().toUpperCase();
    const room = await backendStore.getRoom(normalizedCode);
    if (!room) {
      sendJson(res, 404, { error: "Room not found." });
      return;
    }

    const body = await readRequestJson(req, { maxBytes: roomRequestMaxBytes });
    const participantId = String(body.participantId || body.participant?.id || "").slice(0, 80);
    if (!participantId) {
      sendJson(res, 400, { error: "Missing participant id." });
      return;
    }
    if (!requireRoomParticipantAuth(req, res, room, participantId, body, "Only this participant or the host can submit this answer.")) {
      return;
    }

    const participant = room.participants.find((entry) => entry.id === participantId);
    if (!participant || participant.active === false) {
      sendJson(res, 404, { error: "Participant is not active in this room." });
      return;
    }
    if (normalizeParticipantRole(participant) === "spectator") {
      sendJson(res, 403, { error: "Spectators cannot submit gameplay answers." });
      return;
    }

    const game = room.game && typeof room.game === "object" ? room.game : null;
    const currentMatchId = String(game?.matchId || "").slice(0, 80);
    const currentRound = clampServerNumber(game?.round, 0, 100, 0);
    const payloadMatchId = String(body.matchId || "").slice(0, 80);
    const payloadRound = clampServerNumber(body.round, 0, 100, 0);
    if (room.status !== "in-progress" || !game || game.status === "starting" || game.status === "grading" || game.status === "ended") {
      sendJson(res, 409, { error: "This round is not accepting answers." });
      return;
    }
    if (!currentMatchId || !payloadMatchId || payloadMatchId !== currentMatchId) {
      sendJson(res, 409, { error: "Answer belongs to a previous match." });
      return;
    }
    if (!currentRound || !payloadRound || payloadRound !== currentRound) {
      sendJson(res, 409, { error: "Answer belongs to a previous round." });
      return;
    }

    const existingAnswers = normalizeRoomAnswerState(game.answers, currentMatchId, currentRound);
    const existingAnswer = existingAnswers[participantId];
    if (existingAnswer && existingAnswer.matchId === currentMatchId && Number(existingAnswer.round) === currentRound) {
      const duplicateParticipant = {
        ...participant,
        status: "submitted",
        answer: existingAnswer.answer,
        submittedRound: currentRound,
        submissionMatchId: currentMatchId,
        remainingTime: existingAnswer.remainingTime
      };
      sendJson(res, 200, createRoomEventResponse(room, "answer_submitted", {
        duplicate: true,
        participantId,
        participantName: participant.name || "A player",
        role: normalizeParticipantRole(participant),
        status: "submitted",
        participant: sanitizeParticipantForClient(duplicateParticipant, { includeSubmittedAnswers: true }),
        matchId: currentMatchId,
        round: currentRound,
        answer: existingAnswer.answer,
        remainingTime: existingAnswer.remainingTime,
        submissionStatus: existingAnswer.status,
        autoSubmitted: existingAnswer.autoSubmitted
      }));
      return;
    }

    const answerStatus = body.timedOut || String(body.status || "").toLowerCase() === "timed_out"
      ? "timed_out"
      : "submitted";
    const answer = String(body.answer || "").trim().slice(0, 500);
    const remainingTime = clampServerNumber(body.remainingTime, 0, 600, 0);
    const submittedAt = Date.now();
    const answerState = {
      participantId,
      status: answerStatus,
      answer,
      submittedAt,
      autoSubmitted: Boolean(body.autoSubmitted || answerStatus === "timed_out"),
      remainingTime,
      matchId: currentMatchId,
      round: currentRound
    };

    room.game = normalizeRoomGame(updateRoomParticipantTimerStatus({
      ...game,
      answers: {
        ...existingAnswers,
        [participantId]: answerState
      },
      updatedAt: submittedAt
    }, participantId, { status: "ended", now: submittedAt }));
    participant.status = "submitted";
    participant.answer = answer;
    participant.submittedRound = currentRound;
    participant.submissionMatchId = currentMatchId;
    participant.remainingTime = remainingTime;

    const eventPayload = {
      participantId,
      participantName: participant.name || "A player",
      role: normalizeParticipantRole(participant),
      host: Boolean(participant.host),
      spectator: false,
      status: participant.status,
      participant,
      matchId: currentMatchId,
      round: currentRound,
      answer,
      remainingTime,
      submissionStatus: answerStatus,
      autoSubmitted: answerState.autoSubmitted
    };
    stampRoomEvent(room, "answer_submitted", eventPayload);
    const gradingTransition = startRoomGradingTransition(room, {
      reason: "all-submitted",
      force: false
    });
    finalizeRoom(room);
    const storedRoom = await backendStore.upsertRoom(room);
    const storedParticipant = storedRoom.participants.find((entry) => entry.id === participantId) || participant;
    const response = createRoomEventResponse(storedRoom, "answer_submitted", {
      ...eventPayload,
      participant: sanitizeParticipantForClient(storedParticipant, { includeSubmittedAnswers: true }),
      answer: String(storedParticipant.answer || answer).slice(0, 500),
      remainingTime: clampServerNumber(storedParticipant.remainingTime, 0, 600, remainingTime),
      submissionStatus: answerStatus,
      autoSubmitted: answerState.autoSubmitted
    });
    if (gradingTransition.started) {
      response.grading = createRoomEventResponse(storedRoom, "round_grading", {
        ...gradingTransition.payload,
        game: storedRoom.game || gradingTransition.payload.game
      });
    }
    if (body.includeRoom || body.includeRoomSnapshot) {
      response.room = sanitizeRoomForClient(storedRoom, { includePrivateSecrets: hasRoomHostAuth(req, storedRoom, body) });
    }
    sendJson(res, 200, response);
  } catch (error) {
    sendJson(res, 400, { error: error.message || "Room answer submission failed." });
  }
}

function getRoomGameplayParticipants(room = {}) {
  return (Array.isArray(room.participants) ? room.participants : [])
    .filter(isGameplayParticipant);
}

function getRoomBaseTimerDurationMs(matchSettings = {}, fallbackSettings = {}) {
  const timerSeconds = clampServerNumber(
    matchSettings?.timerSeconds || fallbackSettings?.timerSeconds,
    10,
    60,
    30
  );
  return Math.max(5000, timerSeconds * 1000);
}

function normalizeRoomParticipantTimers(timers = {}) {
  const source = timers && typeof timers === "object" ? timers : {};
  return Object.fromEntries(
    Object.entries(source)
      .map(([participantId, timer]) => {
        const id = String(participantId || "").slice(0, 80);
        if (!id || !timer || typeof timer !== "object") {
          return null;
        }
        return [
          id,
          {
            endsAt: clampServerNumber(timer.endsAt, 0, Number.MAX_SAFE_INTEGER, 0),
            speedMultiplier: clampServerNumber(timer.speedMultiplier, 0.1, 8, 1),
            status: String(timer.status || "").toLowerCase() === "ended" ? "ended" : "running"
          }
        ];
      })
      .filter(Boolean)
  );
}

function getRoomParticipantTimerRemainingMs(timer = {}, now = Date.now()) {
  if (!timer || timer.status === "ended") {
    return 0;
  }
  return Math.max(0, clampServerNumber(timer.endsAt, 0, Number.MAX_SAFE_INTEGER, 0) - now);
}

function getRoomTimerGradingForceAt(participantTimers = {}, fallbackAt = 0, now = Date.now()) {
  const runningEndsAt = Object.values(normalizeRoomParticipantTimers(participantTimers))
    .filter((timer) => timer.status !== "ended")
    .map((timer) => clampServerNumber(timer.endsAt, 0, Number.MAX_SAFE_INTEGER, 0))
    .filter((endsAt) => endsAt > now);
  const latestEndsAt = runningEndsAt.length ? Math.max(...runningEndsAt) : 0;
  return latestEndsAt > 0
    ? latestEndsAt + 2000
    : clampServerNumber(fallbackAt, 0, Number.MAX_SAFE_INTEGER, now);
}

function createRoomTimerState(room = {}, matchSettings = {}, roundStartedAt = Date.now()) {
  const baseDurationMs = getRoomBaseTimerDurationMs(matchSettings, room.settings);
  const participantTimers = Object.fromEntries(
    getRoomGameplayParticipants(room)
      .map((participant) => {
        const participantId = String(participant.id || "").slice(0, 80);
        return participantId
          ? [participantId, {
            endsAt: roundStartedAt + baseDurationMs,
            speedMultiplier: 1,
            status: "running"
          }]
          : null;
      })
      .filter(Boolean)
  );
  return {
    baseDurationMs,
    participantTimers,
    gradingForceAt: getRoomTimerGradingForceAt(participantTimers, roundStartedAt + baseDurationMs + 2000, roundStartedAt)
  };
}

function getRoomTimerStatePayload(game = {}) {
  if (!game || typeof game !== "object") {
    return null;
  }
  return {
    roundStartedAt: clampServerNumber(game.roundStartedAt || game.startedAt, 0, Number.MAX_SAFE_INTEGER, 0),
    baseDurationMs: clampServerNumber(game.baseDurationMs, 5000, 60000, getRoomBaseTimerDurationMs(game.matchSettings || game.settings || {}, {})),
    participantTimers: normalizeRoomParticipantTimers(game.participantTimers),
    gradingForceAt: clampServerNumber(game.gradingForceAt, 0, Number.MAX_SAFE_INTEGER, 0)
  };
}

function updateRoomParticipantTimerStatus(game = {}, participantId = "", options = {}) {
  const id = String(participantId || "").slice(0, 80);
  if (!game || typeof game !== "object" || !id) {
    return game;
  }
  const now = clampServerNumber(options.now, 0, Number.MAX_SAFE_INTEGER, Date.now());
  const participantTimers = normalizeRoomParticipantTimers(game.participantTimers);
  const existingTimer = participantTimers[id] || {
    endsAt: now,
    speedMultiplier: 1,
    status: "running"
  };
  participantTimers[id] = {
    ...existingTimer,
    endsAt: Math.min(
      clampServerNumber(existingTimer.endsAt, 0, Number.MAX_SAFE_INTEGER, now),
      now
    ),
    status: options.status === "running" ? "running" : "ended"
  };
  return {
    ...game,
    participantTimers,
    gradingForceAt: getRoomTimerGradingForceAt(participantTimers, game.gradingForceAt, now)
  };
}

function applyRoomTimerAction(room = {}, body = {}) {
  const game = room.game && typeof room.game === "object" ? room.game : null;
  if (!game || game.status !== "playing") {
    return null;
  }
  const action = body.timerAction && typeof body.timerAction === "object" ? body.timerAction : null;
  const actionType = String(action?.type || "").trim().toLowerCase();
  const powerId = String(body.powerId || "").trim();
  if (actionType !== "time_bender" && powerId !== "time_bender") {
    return null;
  }

  const actorParticipantId = String(body.actorParticipantId || "").slice(0, 80);
  const participants = getRoomGameplayParticipants(room);
  if (!actorParticipantId || !participants.some((participant) => participant.id === actorParticipantId)) {
    return null;
  }

  const now = Date.now();
  const matchSettings = game.matchSettings || room.settings || {};
  const baseDurationMs = clampServerNumber(game.baseDurationMs, 5000, 60000, getRoomBaseTimerDurationMs(matchSettings, room.settings));
  const existingTimers = normalizeRoomParticipantTimers(game.participantTimers);
  const participantTimers = Object.fromEntries(
    participants
      .map((participant) => {
        const participantId = String(participant.id || "").slice(0, 80);
        if (!participantId) {
          return null;
        }
        const timer = existingTimers[participantId] || {
          endsAt: now + baseDurationMs,
          speedMultiplier: 1,
          status: "running"
        };
        const remainingMs = getRoomParticipantTimerRemainingMs(timer, now);
        if (timer.status === "ended" || remainingMs <= 0) {
          return [participantId, {
            ...timer,
            endsAt: Math.min(clampServerNumber(timer.endsAt, 0, Number.MAX_SAFE_INTEGER, now), now),
            status: "ended"
          }];
        }
        if (participantId === actorParticipantId) {
          return [participantId, {
            ...timer,
            endsAt: Math.min(now + 99000, now + remainingMs + 5000),
            status: "running"
          }];
        }
        if ((Number(timer.speedMultiplier) || 1) >= 2) {
          return [participantId, timer];
        }
        return [participantId, {
          ...timer,
          endsAt: now + Math.ceil(remainingMs / 2),
          speedMultiplier: 2,
          status: "running"
        }];
      })
      .filter(Boolean)
  );

  room.game = normalizeRoomGame({
    ...game,
    baseDurationMs,
    participantTimers,
    gradingForceAt: getRoomTimerGradingForceAt(participantTimers, game.gradingForceAt, now),
    updatedAt: now
  });
  return getRoomTimerStatePayload(room.game);
}

function normalizeRoomGradingReason(reason = "") {
  const normalized = String(reason || "").trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").slice(0, 60);
  return normalized || "all-submitted";
}

function getParticipantAnswerStateForRound(participant = {}, answers = {}, matchId = "", round = 0) {
  const participantId = String(participant.id || "").slice(0, 80);
  if (!participantId) {
    return null;
  }
  const existing = answers[participantId];
  if (
    existing
    && existing.matchId === matchId
    && Number(existing.round) === Number(round)
  ) {
    return existing;
  }
  const submittedRound = clampServerNumber(participant.submittedRound, 0, 100, 0);
  const submissionMatchId = String(participant.submissionMatchId || "").slice(0, 80);
  if (submittedRound !== Number(round) || (matchId && submissionMatchId && submissionMatchId !== matchId)) {
    return null;
  }
  if (participant.status !== "submitted" && participant.status !== "timed_out") {
    return null;
  }
  const status = participant.status === "timed_out" ? "timed_out" : "submitted";
  return {
    participantId,
    status,
    answer: String(participant.answer || "").trim().slice(0, 500),
    submittedAt: clampServerNumber(participant.submittedAt || participant.updatedAt, 0, Number.MAX_SAFE_INTEGER, Date.now()),
    autoSubmitted: status === "timed_out",
    remainingTime: clampServerNumber(participant.remainingTime, 0, 600, 0),
    matchId,
    round
  };
}

function getRoomGradingSubmissionMap(submissions = []) {
  return new Map(
    normalizeRoundSkipSubmissions(submissions)
      .map((submission) => [submission.participantId, submission])
  );
}

function createRoomAnswerStateFromSubmission(participant = {}, submission = {}, options = {}) {
  const participantId = String(participant.id || submission.participantId || "").slice(0, 80);
  const status = submission.status === "timed_out" || options.defaultStatus === "timed_out"
    ? "timed_out"
    : "submitted";
  return {
    participantId,
    status,
    answer: String(submission.answer || "").trim().slice(0, 500),
    submittedAt: clampServerNumber(submission.submittedAt || options.now, 0, Number.MAX_SAFE_INTEGER, options.now || Date.now()),
    autoSubmitted: Boolean(submission.autoSubmitted || status === "timed_out" || options.autoSubmitted),
    remainingTime: clampServerNumber(submission.remainingTime, 0, 600, 0),
    matchId: String(options.matchId || "").slice(0, 80),
    round: clampServerNumber(options.round, 0, 100, 0)
  };
}

function applyAnswerStateToParticipant(participant = {}, answerState = {}) {
  participant.status = "submitted";
  participant.answer = String(answerState.answer || "").slice(0, 500);
  participant.submittedRound = clampServerNumber(answerState.round, 0, 100, 0);
  participant.submissionMatchId = String(answerState.matchId || "").slice(0, 80);
  participant.remainingTime = clampServerNumber(answerState.remainingTime, 0, 600, 0);
  participant.submittedAt = clampServerNumber(answerState.submittedAt, 0, Number.MAX_SAFE_INTEGER, Date.now());
}

function getRoomGradingSubmissions(participants = [], answers = {}) {
  return participants
    .map((participant) => {
      const answerState = answers[String(participant.id || "").slice(0, 80)];
      if (!answerState) {
        return null;
      }
      return {
        participantId: answerState.participantId,
        answer: String(answerState.answer || "").slice(0, 500),
        remainingTime: clampServerNumber(answerState.remainingTime, 0, 600, 0),
        status: answerState.status,
        autoSubmitted: Boolean(answerState.autoSubmitted)
      };
    })
    .filter(Boolean);
}

function startRoomGradingTransition(room, options = {}) {
  const game = room.game && typeof room.game === "object" ? room.game : null;
  if (!game || room.status !== "in-progress") {
    return { started: false, duplicate: false, pendingParticipantIds: [] };
  }
  const matchId = String(game.matchId || options.matchId || "").slice(0, 80);
  const round = clampServerNumber(game.round || options.round, 0, 100, 0);
  if (!matchId || !round) {
    return { started: false, duplicate: false, pendingParticipantIds: [] };
  }
  const participants = getRoomGameplayParticipants(room);
  const existingAnswers = normalizeRoomAnswerState(game.answers, matchId, round);
  const submissionMap = getRoomGradingSubmissionMap(options.submissions);
  const answers = { ...existingAnswers };
  const reason = normalizeRoomGradingReason(options.reason);
  const defaultStatus = reason === "timer-expired" ? "timed_out" : "submitted";
  const now = Date.now();
  const pendingParticipantIds = [];

  participants.forEach((participant) => {
    const participantId = String(participant.id || "").slice(0, 80);
    const currentAnswer = getParticipantAnswerStateForRound(participant, answers, matchId, round);
    if (currentAnswer) {
      answers[participantId] = currentAnswer;
      return;
    }
    const submission = submissionMap.get(participantId);
    if (submission || options.force) {
      answers[participantId] = createRoomAnswerStateFromSubmission(participant, submission || { participantId }, {
        matchId,
        round,
        now,
        defaultStatus,
        autoSubmitted: !submission || reason === "timer-expired"
      });
      return;
    }
    pendingParticipantIds.push(participantId);
  });

  if (pendingParticipantIds.length && !options.force) {
    return { started: false, duplicate: false, pendingParticipantIds };
  }

  participants.forEach((participant) => {
    const answerState = answers[String(participant.id || "").slice(0, 80)];
    if (answerState) {
      applyAnswerStateToParticipant(participant, answerState);
    }
  });

  if (game.status === "grading" || game.roundResult) {
    return {
      started: false,
      duplicate: true,
      pendingParticipantIds: [],
      payload: {
        round,
        matchId,
        reason: game.gradingReason || reason,
        hostParticipantId: String(options.hostParticipantId || "").slice(0, 80),
        submissions: getRoomGradingSubmissions(participants, answers),
        game: room.game
      }
    };
  }

  let lockedGame = {
    ...game,
    status: "grading",
    round,
    answers,
    roundResult: null,
    gradingStartedAt: now,
    gradingReason: reason,
    gradingForceAt: clampServerNumber(options.gradingForceAt, 0, Number.MAX_SAFE_INTEGER, 0),
    updatedAt: now
  };
  participants.forEach((participant) => {
    lockedGame = updateRoomParticipantTimerStatus(lockedGame, participant.id, { status: "ended", now });
  });
  room.game = normalizeRoomGame({
    ...lockedGame,
    gradingForceAt: clampServerNumber(options.gradingForceAt, 0, Number.MAX_SAFE_INTEGER, lockedGame.gradingForceAt || now)
  });
  const payload = {
    round,
    matchId,
    reason,
    hostParticipantId: String(options.hostParticipantId || "").slice(0, 80),
    submissions: getRoomGradingSubmissions(participants, answers),
    game: room.game
  };
  stampRoomEvent(room, "round_grading", payload);
  return {
    started: true,
    duplicate: false,
    pendingParticipantIds: [],
    payload
  };
}

async function handleRoomRoundGrading(req, res, code) {
  try {
    const normalizedCode = String(code || "").trim().toUpperCase();
    const room = await backendStore.getRoom(normalizedCode);
    if (!room) {
      sendJson(res, 404, { error: "Room not found." });
      return;
    }

    const body = await readRequestJson(req, { maxBytes: roomRequestMaxBytes });
    const hostParticipantId = String(body.hostParticipantId || "").slice(0, 80);
    if (!requireRoomHostAuth(req, res, room, body, "Only the host can move the round to grading.")) {
      return;
    }
    const currentMatchId = String(room.game?.matchId || "").slice(0, 80);
    const payloadMatchId = String(body.matchId || "").slice(0, 80);
    if (payloadMatchId && currentMatchId && payloadMatchId !== currentMatchId) {
      sendJson(res, 409, { error: "Grading request belongs to a previous match." });
      return;
    }
    const currentRound = clampServerNumber(room.game?.round, 0, 100, 0);
    const round = clampServerNumber(body.round, 1, 100, currentRound || 1);
    if (currentRound && round !== currentRound) {
      sendJson(res, 409, { error: "Grading request belongs to a different round." });
      return;
    }

    const transition = startRoomGradingTransition(room, {
      force: true,
      reason: body.reason || "host-skip",
      hostParticipantId,
      matchId: currentMatchId || payloadMatchId,
      round,
      submissions: body.submissions,
      gradingForceAt: body.gradingForceAt
    });
    if (!transition.started && !transition.duplicate) {
      sendJson(res, 409, {
        error: "Round still has pending answers.",
        pendingParticipantIds: transition.pendingParticipantIds
      });
      return;
    }
    finalizeRoom(room);
    const storedRoom = await backendStore.upsertRoom(room);
    sendJson(res, 200, createRoomEventResponse(storedRoom, "round_grading", {
      ...(transition.payload || {}),
      duplicate: Boolean(transition.duplicate),
      game: storedRoom.game || transition.payload?.game || null
    }));
  } catch (error) {
    sendJson(res, 400, { error: error.message || "Round grading transition failed." });
  }
}

async function handleRoomPowerState(req, res, code) {
  try {
    const normalizedCode = String(code || "").trim().toUpperCase();
    const room = await backendStore.getRoom(normalizedCode);
    if (!room) {
      sendJson(res, 404, { error: "Room not found." });
      return;
    }

    const body = await readRequestJson(req, { maxBytes: roomRequestMaxBytes });
    const actorParticipantId = String(body.actorParticipantId || "").slice(0, 120);
    const requestHasHostAuth = hasRoomHostAuth(req, room, body);
    if (!requestHasHostAuth) {
      if (!actorParticipantId) {
        sendJson(res, 400, { error: "Missing actor participant id." });
        return;
      }
      if (!requireRoomParticipantAuth(req, res, room, actorParticipantId, body, "Only the acting participant can update power state.")) {
        return;
      }
      const actorParticipant = room.participants.find((participant) => participant.id === actorParticipantId);
      if (!actorParticipant || !isGameplayParticipant(actorParticipant)) {
        sendJson(res, 403, { error: "Spectators cannot update power state." });
        return;
      }
    }
    const currentMatchId = String(room.game?.matchId || "").slice(0, 80);
    const payloadMatchId = String(body.matchId || body.powerState?.matchId || "").slice(0, 80);
    if (payloadMatchId && currentMatchId && payloadMatchId !== currentMatchId) {
      sendJson(res, 409, { error: "Power state belongs to a previous match." });
      return;
    }
    const currentRound = clampServerNumber(room.game?.round, 0, 100, 0);
    const payloadRound = clampServerNumber(body.round || body.powerState?.round, 0, 100, 0);
    if (payloadRound && currentRound && payloadRound < currentRound) {
      sendJson(res, 409, { error: "Power state belongs to a previous round." });
      return;
    }
    const submittedPowerState = stripClientPowerStateRevisions({
      matchId: payloadMatchId || currentMatchId,
      updatedAt: Date.now(),
      hands: body.hands,
      played: body.played,
      players: body.players,
      effects: body.effects
    });
    const powerState = filterRoomPowerStateParticipants(submittedPowerState, room);
    if (!powerState) {
      sendJson(res, 400, { error: "Room power update needs a power state payload." });
      return;
    }
    const previousPowerState = normalizeRoomPowerState(room.game?.powerState);
    const mergedPowerState = stampRoomPowerStateServerRevision(
      previousPowerState,
      powerState,
      mergeRoomPowerState(previousPowerState, powerState),
      getRoomPowerStateRevision(previousPowerState) + 1
    );
    if (!room.game || typeof room.game !== "object") {
      room.game = {
        matchId: payloadMatchId || `${normalizedCode}-${Date.now()}`,
        status: "playing",
        round: clampServerNumber(body.round, 1, 100, 1),
        setup: null,
        powerState: mergedPowerState,
        updatedAt: Date.now()
      };
    } else {
      room.game.powerState = mergedPowerState;
      room.game.updatedAt = Date.now();
    }
    const timerState = applyRoomTimerAction(room, body);
    stampRoomEvent(room, "power_state", {
      round: clampServerNumber(body.round, 0, 100, room.game.round || 0),
      powerId: String(body.powerId || "").slice(0, 80),
      actorParticipantId,
      targetParticipantId: String(body.targetParticipantId || "").slice(0, 120),
      deletedPowerId: String(body.deletedPowerId || "").slice(0, 80),
      stolenPowerId: String(body.stolenPowerId || "").slice(0, 80),
      matchId: room.game?.matchId || powerState.matchId || "",
      powerState: mergedPowerState,
      timerState
    });
    finalizeRoom(room);
    const storedRoom = await backendStore.upsertRoom(room);
    const responsePowerState = normalizeRoomPowerState(storedRoom.game?.powerState) || mergedPowerState;
    sendJson(res, 200, createRoomEventResponse(storedRoom, "power_state", {
      round: clampServerNumber(body.round, 0, 100, storedRoom.game?.round || 0),
      matchId: storedRoom.game?.matchId || responsePowerState.matchId || "",
      powerId: String(body.powerId || "").slice(0, 80),
      actorParticipantId,
      targetParticipantId: String(body.targetParticipantId || "").slice(0, 120),
      deletedPowerId: String(body.deletedPowerId || "").slice(0, 80),
      stolenPowerId: String(body.stolenPowerId || "").slice(0, 80),
      powerState: responsePowerState,
      powerRevision: responsePowerState.revision || 0,
      hands: responsePowerState.hands,
      played: responsePowerState.played,
      players: responsePowerState.players,
      effects: responsePowerState.effects,
      timerState: getRoomTimerStatePayload(storedRoom.game) || timerState
    }));
  } catch (error) {
    sendJson(res, 400, { error: error.message || "Room power update failed." });
  }
}

async function handleRoomRoundResult(req, res, code) {
  try {
    const normalizedCode = String(code || "").trim().toUpperCase();
    const room = await backendStore.getRoom(normalizedCode);
    if (!room) {
      sendJson(res, 404, { error: "Room not found." });
      return;
    }

    const body = await readRequestJson(req, { maxBytes: roomRequestMaxBytes });
    if (!requireRoomHostAuth(req, res, room, body, "Only the host can publish round results.")) {
      return;
    }
    const roundResult = normalizeRoomRoundResult(body.roundResult || body);
    if (!roundResult) {
      sendJson(res, 400, { error: "Round result payload is incomplete." });
      return;
    }
    const currentMatchId = String(room.game?.matchId || "").slice(0, 80);
    if (roundResult.matchId && currentMatchId && roundResult.matchId !== currentMatchId) {
      sendJson(res, 409, { error: "Round result belongs to a previous match." });
      return;
    }
    const currentRound = clampServerNumber(room.game?.round, 0, 100, 0);
    if (roundResult.round && currentRound && roundResult.round !== currentRound) {
      sendJson(res, 409, { error: "Round result belongs to a different round." });
      return;
    }
    if (!roundResult.matchId && currentMatchId) {
      roundResult.matchId = currentMatchId;
    }
    if (room.game?.status !== "grading" && !room.game?.roundResult) {
      sendJson(res, 409, { error: "Round must be locked for grading before publishing results." });
      return;
    }

    room.status = "in-progress";
    room.game = normalizeRoomGame({
      ...(room.game || {}),
      status: "grading",
      round: roundResult.round,
      roundResult,
      updatedAt: Date.now()
    });
    stampRoomEvent(room, "round_result", {
      round: roundResult.round,
      matchId: room.game?.matchId || "",
      roundResult,
      game: room.game
    });
    finalizeRoom(room);
    const storedRoom = await backendStore.upsertRoom(room);
    sendJson(res, 200, createRoomEventResponse(storedRoom, "round_result", {
      matchId: storedRoom.game?.matchId || roundResult.matchId || "",
      round: storedRoom.game?.round || roundResult.round,
      roundResult: storedRoom.game?.roundResult || roundResult,
      game: storedRoom.game || room.game
    }));
  } catch (error) {
    sendJson(res, 400, { error: error.message || "Round result sync failed." });
  }
}

function normalizeRoundSkipSubmissions(submissions) {
  return (Array.isArray(submissions) ? submissions : [])
    .map((entry) => {
      const source = entry && typeof entry === "object" ? entry : {};
      return {
        participantId: String(source.participantId || "").slice(0, 120),
        owner: String(source.owner || "").slice(0, 80),
        answer: String(source.answer || "").slice(0, 500),
        remainingTime: clampServerNumber(source.remainingTime, 0, 600, 0),
        status: String(source.status || "").toLowerCase() === "timed_out" ? "timed_out" : "submitted",
        autoSubmitted: Boolean(source.autoSubmitted),
        submittedAt: clampServerNumber(source.submittedAt, 0, Number.MAX_SAFE_INTEGER, 0)
      };
    })
    .filter((entry) => entry.participantId)
    .slice(0, 10);
}

async function handleRoomRoundSkip(req, res, code) {
  try {
    const normalizedCode = String(code || "").trim().toUpperCase();
    const room = await backendStore.getRoom(normalizedCode);
    if (!room) {
      sendJson(res, 404, { error: "Room not found." });
      return;
    }

    const body = await readRequestJson(req, { maxBytes: roomRequestMaxBytes });
    const hostParticipantId = String(body.hostParticipantId || "").slice(0, 80);
    if (!requireRoomHostAuth(req, res, room, body, "Only the host can skip to grading.")) {
      return;
    }

    const currentMatchId = String(room.game?.matchId || "").slice(0, 80);
    const payloadMatchId = String(body.matchId || "").slice(0, 80);
    if (payloadMatchId && currentMatchId && payloadMatchId !== currentMatchId) {
      sendJson(res, 409, { error: "Round skip belongs to a previous match." });
      return;
    }
    const currentRound = clampServerNumber(room.game?.round, 0, 100, 0);
    const round = clampServerNumber(body.round, 1, 100, currentRound || 1);
    if (currentRound && round !== currentRound) {
      sendJson(res, 409, { error: "Round skip belongs to a different round." });
      return;
    }
    const matchId = currentMatchId || payloadMatchId;
    const transition = startRoomGradingTransition(room, {
      force: true,
      reason: body.reason || "host-skip",
      hostParticipantId,
      matchId,
      round,
      submissions: body.submissions,
      gradingForceAt: body.gradingForceAt
    });
    if (!transition.started && !transition.duplicate) {
      sendJson(res, 409, {
        error: "Round still has pending answers.",
        pendingParticipantIds: transition.pendingParticipantIds
      });
      return;
    }
    finalizeRoom(room);
    const storedRoom = await backendStore.upsertRoom(room);
    sendJson(res, 200, createRoomEventResponse(storedRoom, "round_grading", {
      ...(transition.payload || {}),
      duplicate: Boolean(transition.duplicate),
      game: storedRoom.game || transition.payload?.game || null
    }));
  } catch (error) {
    sendJson(res, 400, { error: error.message || "Round skip failed." });
  }
}

async function handleRoomEvents(req, url, res, code) {
  const room = await backendStore.getRoom(String(code || "").trim().toUpperCase());
  if (!room) {
    const close = await backendStore.getRoomClose(String(code || "").trim().toUpperCase());
    if (close) {
      sendJson(res, 410, { closed: true, close, events: [] });
      return;
    }
    sendJson(res, 404, { error: "Room not found." });
    return;
  }
  const since = clampServerNumber(url.searchParams.get("since"), 0, Number.MAX_SAFE_INTEGER, 0);
  const includePrivateSecrets = hasRoomHostAuth(req, room);
  const includeSubmittedAnswers = shouldExposeRoomAnswers(room, { includePrivateSecrets });
  const events = normalizeRoomEvents(room.events)
    .filter((event) => event.revision > since)
    .map((event) => sanitizeRoomEventForClient(event, { includePrivateSecrets, includeSubmittedAnswers }));
  sendJson(res, 200, {
    code: room.code,
    revision: getRoomRevision(room),
    updatedAt: room.updatedAt,
    events
  });
}

function isHostParticipant(room, participantId) {
  const id = String(participantId || "").slice(0, 80);
  return Boolean(id && (id === room.host?.id || room.participants.some((participant) => participant.id === id && normalizeParticipantRole(participant) === "host")));
}

async function handleRoomModeration(req, res, code) {
  try {
    const normalizedCode = String(code || "").trim().toUpperCase();
    const room = await backendStore.getRoom(normalizedCode);
    if (!room) {
      sendJson(res, 404, { error: "Room not found." });
      return;
    }

    const body = await readRequestJson(req, { maxBytes: roomRequestMaxBytes });
    const hostParticipantId = String(body.hostParticipantId || "").slice(0, 80);
    if (!requireRoomHostAuth(req, res, room, body, "Only the host can moderate this room.")) {
      return;
    }

    const action = String(body.action || "").slice(0, 32);
    const participantId = String(body.participantId || "").slice(0, 80);
    const participant = room.participants.find((entry) => entry.id === participantId);
    if (!participant || normalizeParticipantRole(participant) === "host" || participant.id === room.host?.id) {
      sendJson(res, 404, { error: "Participant not found." });
      return;
    }

    if (action === "mute" || action === "unmute" || action === "set-muted") {
      const muted = action === "mute" ? true : action === "unmute" ? false : Boolean(body.muted);
      participant.muted = muted;
      participant.status = muted ? "muted" : String(participant.status || "joined").slice(0, 32);
    } else if (action === "kick" || action === "ban") {
      const shouldRemoveParticipant = action === "kick" && normalizeParticipantRole(participant) === "bot";
      participant.active = false;
      participant.status = action === "ban" ? "banned" : "kicked";
      if (shouldRemoveParticipant) {
        room.participants = room.participants.filter((entry) => entry.id !== participantId);
      }
      if (action === "ban") {
        room.banned = [...new Set([...(Array.isArray(room.banned) ? room.banned : []), participant.id, participant.name, participant.profileUserId].filter(Boolean))];
      }
    } else {
      sendJson(res, 400, { error: "Unknown moderation action." });
      return;
    }

    finalizeRoom(room);
    stampRoomEvent(room, "participant_moderated", {
      action,
      participantId,
      muted: Boolean(participant.muted),
      banned: room.banned || [],
      participant
    });
    if (!hasActiveRealPlayers(room)) {
      await closeStoredRoom(normalizedCode, "empty-room");
      sendJson(res, 200, { closed: true, code: normalizedCode, reason: "empty-room" });
      return;
    }
    const storedRoom = await backendStore.upsertRoom(room);
    const storedParticipant = storedRoom.participants.find((entry) => entry.id === participantId) || participant;
    sendJson(res, 200, createRoomEventResponse(storedRoom, "participant_moderated", {
      action,
      participantId,
      participant: sanitizeParticipantForClient(storedParticipant),
      banned: storedRoom.banned || [],
      room: sanitizeRoomForClient(storedRoom, { includePrivateSecrets: true })
    }));
  } catch (error) {
    sendJson(res, 400, { error: error.message || "Room moderation failed." });
  }
}

async function handleRoomClose(req, res, code) {
  try {
    const normalizedCode = String(code || "").trim().toUpperCase();
    const room = await backendStore.getRoom(normalizedCode);
    if (!room) {
      const close = await backendStore.getRoomClose(normalizedCode);
      sendJson(res, close ? 200 : 404, close ? { closed: true, code: normalizedCode, close } : { error: "Room not found." });
      return;
    }

    const body = await readRequestJson(req);
    const participantId = String(body.participantId || "").slice(0, 80);
    if (!requireRoomHostAuth(req, res, room, body, "Only the host can close this room.")) {
      return;
    }
    const reason = String(body.reason || "host-left").slice(0, 60);
    await closeStoredRoom(normalizedCode, reason);
    sendJson(res, 200, {
      closed: true,
      code: normalizedCode,
      reason
    });
  } catch (error) {
    sendJson(res, 400, { error: error.message || "Room close failed." });
  }
}

function normalizeRoom(room) {
  const code = String(room.code || "").trim().toUpperCase();
  if (!/^CAI-\d{4}$/.test(code)) {
    throw new Error("Invalid room code.");
  }

  const settings = room.settings && typeof room.settings === "object" ? room.settings : {};
  const host = room.host && typeof room.host === "object" ? room.host : {};
  const participants = Array.isArray(room.participants) ? room.participants.map(normalizeParticipant) : [];
  const normalizedRoom = {
    code,
    status: ["draft", "lobby", "in-progress", "complete"].includes(room.status) ? room.status : "lobby",
    settings: normalizeRoomSettings(settings, code),
    host: {
      id: String(host.id || participants.find((entry) => normalizeParticipantRole(entry) === "host")?.id || "host").slice(0, 80),
      profileUserId: String(host.profileUserId || host.userId || participants.find((entry) => normalizeParticipantRole(entry) === "host")?.profileUserId || host.id || "host").slice(0, 140),
      name: String(host.name || "Host").slice(0, 24),
      avatar: String(host.avatar || "").slice(0, 60000),
      equippedTitleId: String(host.equippedTitleId || "").slice(0, 80),
      specialBadges: normalizeSpecialBadges(host.specialBadges),
      cardCustomization: normalizeCardCustomization(host.cardCustomization)
    },
    participants,
    banned: Array.isArray(room.banned) ? room.banned.map((entry) => String(entry).slice(0, 80)) : [],
    game: normalizeRoomGame(room.game),
    chat: normalizeRoomChat(room.chat),
    hostExitPendingAt: clampServerNumber(room.hostExitPendingAt, 0, Number.MAX_SAFE_INTEGER, 0),
    revision: clampServerNumber(room.revision, 0, Number.MAX_SAFE_INTEGER, 0),
    events: normalizeRoomEvents(room.events),
    updatedAt: Date.now()
  };
  finalizeRoom(normalizedRoom);
  return normalizedRoom;
}

function normalizeRoomSettings(settings = {}, code = "") {
  const source = settings && typeof settings === "object" ? settings : {};
  const classicMode = Boolean(source.classicMode);
  return {
    rounds: clampServerNumber(source.rounds, 1, 10, 10),
    timerSeconds: clampServerNumber(source.timerSeconds, 10, 60, 30),
    maxPlayers: clampServerNumber(source.maxPlayers, 2, 10, 5),
    harsh: classicMode ? false : Boolean(source.harsh),
    chaos: classicMode ? false : Boolean(source.chaos),
    timeMoney: classicMode ? false : Boolean(source.timeMoney),
    amplified: classicMode ? false : Boolean(source.amplified),
    wildFire: classicMode ? false : Boolean(source.wildFire),
    partyMayhem: classicMode ? false : Boolean(source.partyMayhem),
    classicMode,
    randomModifiers: classicMode ? false : Boolean(source.randomModifiers),
    autoAdvance: source.autoAdvance !== false,
    private: Boolean(source.private),
    password: String(source.password || "").slice(0, 32),
    enabledThemes: normalizeEnabledThemes(source.enabledThemes),
    code: String(code || source.code || "").trim().toUpperCase()
  };
}

function normalizeParticipantRole(participant = {}) {
  const source = participant && typeof participant === "object" ? participant : {};
  const role = String(source.role || "").trim().toLowerCase();
  if (role === "host" || source.host) {
    return "host";
  }
  if (role === "bot" || source.bot) {
    return "bot";
  }
  if (role === "spectator" || source.spectator) {
    return "spectator";
  }
  return "player";
}

function isGameplayParticipant(participant = {}) {
  return participant?.active !== false && normalizeParticipantRole(participant) !== "spectator";
}

function isSpectatorParticipant(participant = {}) {
  return participant?.active !== false && normalizeParticipantRole(participant) === "spectator";
}

function getParticipantDefaultStatus(role = "player") {
  if (role === "host") {
    return "host";
  }
  if (role === "bot") {
    return "bot";
  }
  if (role === "spectator") {
    return "spectating";
  }
  return "joined";
}

function normalizeParticipant(participant) {
  const id = String(participant.id || "").slice(0, 80);
  if (!id) {
    throw new Error("Missing participant id.");
  }
  const role = normalizeParticipantRole(participant);

  return {
    id,
    userId: String(participant.userId || participant.profileUserId || id).slice(0, 140),
    profileUserId: String(participant.profileUserId || participant.userId || id).slice(0, 140),
    connectionId: String(participant.connectionId || "").slice(0, 120),
    name: String(participant.name || "Guest").slice(0, 24),
    avatar: String(participant.avatar || "").slice(0, 60000),
    equippedTitleId: String(participant.equippedTitleId || "").slice(0, 80),
    specialBadges: normalizeSpecialBadges(participant.specialBadges),
    cardCustomization: normalizeCardCustomization(participant.cardCustomization),
    role,
    host: role === "host",
    spectator: role === "spectator",
    bot: role === "bot",
    active: participant.active !== false,
    muted: Boolean(participant.muted),
    status: String(participant.status || getParticipantDefaultStatus(role)).slice(0, 32),
    answer: String(participant.answer || "").slice(0, 500),
    submittedRound: clampServerNumber(participant.submittedRound, 0, 100, 0),
    submissionMatchId: String(participant.submissionMatchId || "").slice(0, 80),
    remainingTime: clampServerNumber(participant.remainingTime, 0, 600, 0),
    disconnectedAt: clampServerNumber(participant.disconnectedAt, 0, Number.MAX_SAFE_INTEGER, 0),
    lastConnectedAt: clampServerNumber(participant.lastConnectedAt, 0, Number.MAX_SAFE_INTEGER, 0),
    joinedAt: clampServerNumber(participant.joinedAt, 0, Number.MAX_SAFE_INTEGER, 0)
  };
}

async function handleRoomLeave(req, res, code) {
  try {
    const normalizedCode = String(code || "").trim().toUpperCase();
    const room = await backendStore.getRoom(normalizedCode);
    if (!room) {
      sendJson(res, 200, { closed: true, code: normalizedCode });
      return;
    }

    const body = await readRequestJson(req);
    const participantId = String(body.participantId || "").slice(0, 80);
    const reason = String(body.reason || "manual").slice(0, 40);
    const isHostLeaving = isHostParticipant(room, participantId);
    if (isHostLeaving) {
      if (!requireRoomHostAuth(req, res, room, body, "Only the host can close this room.")) {
        return;
      }
      await closeStoredRoom(normalizedCode, "host-left");
      sendJson(res, 200, { closed: true, code: normalizedCode, reason: "host-left" });
      return;
    }
    if (!requireRoomParticipantAuth(req, res, room, participantId, body, "Only this participant can leave the room.")) {
      return;
    }

    const leavingParticipant = room.participants.find((participant) => participant.id === participantId) || null;
    room.participants = room.participants.filter((participant) => participant.id !== participantId);
    finalizeRoom(room);
    if (!hasActiveRealPlayers(room)) {
      await closeStoredRoom(normalizedCode, "empty-room");
      sendJson(res, 200, { closed: true, code: normalizedCode, reason: "empty-room" });
      return;
    }

    stampRoomEvent(room, "participant_left", {
      participantId,
      participantName: leavingParticipant?.name || "A player",
      participant: leavingParticipant
    });
    const storedRoom = await backendStore.upsertRoom(room);
    sendJson(res, 200, { room: sanitizeRoomForClient(storedRoom), participant: leavingParticipant, closed: false });
  } catch (error) {
    sendJson(res, 400, { error: error.message || "Room leave failed." });
  }
}

function normalizeRoomChat(chat) {
  const messages = Array.isArray(chat) ? chat : [];
  return messages
    .map((message) => {
      const source = message && typeof message === "object" ? message : {};
      return {
        id: String(source.id || "").slice(0, 120),
        sender: String(source.sender || "System").slice(0, 32),
        avatar: String(source.avatar || "").slice(0, 60000),
        equippedTitleId: String(source.equippedTitleId || "").slice(0, 80),
        specialBadges: normalizeSpecialBadges(source.specialBadges),
        cardCustomization: normalizeCardCustomization(source.cardCustomization),
        text: String(source.text || "").trim().slice(0, 220),
        owner: String(source.owner || "").slice(0, 80),
        participantId: String(source.participantId || "").slice(0, 80),
        host: Boolean(source.host),
        spectator: Boolean(source.spectator),
        private: Boolean(source.private),
        audience: String(source.audience || "").slice(0, 80),
        createdAt: clampServerNumber(source.createdAt, 0, Number.MAX_SAFE_INTEGER, Date.now())
      };
    })
    .filter((message) => message.text)
    .slice(-50);
}

function normalizeSpecialBadges(value) {
  const allowed = new Set(["admin", "verified", "creator"]);
  const seen = new Set();
  return (Array.isArray(value) ? value : [])
    .map((badge) => ({
      id: typeof badge === "string" ? badge : String(badge?.id || ""),
      count: clampServerNumber(typeof badge === "string" ? 0 : badge?.count, 0, 100000, 0)
    }))
    .filter((badge) => {
      if (!allowed.has(badge.id) || seen.has(badge.id)) {
        return false;
      }
      seen.add(badge.id);
      return true;
    })
    .sort((a, b) => ["admin", "verified", "creator"].indexOf(a.id) - ["admin", "verified", "creator"].indexOf(b.id));
}

function normalizeCardCustomization(customization) {
  if (!customization || typeof customization !== "object") {
    return null;
  }
  return {
    styleId: String(customization.styleId || "default").slice(0, 48),
    gradientTop: String(customization.gradientTop || "blue").slice(0, 48),
    gradientBottom: String(customization.gradientBottom || "pink").slice(0, 48),
    effectIds: Array.isArray(customization.effectIds)
      ? customization.effectIds.map((id) => String(id).slice(0, 48)).filter(Boolean).slice(0, 8)
      : [],
    patternId: String(customization.patternId || "none").slice(0, 48),
    fontId: String(customization.fontId || "default").slice(0, 48),
    titleColourId: String(customization.titleColourId || "rarity").slice(0, 48),
    titleRgb: Boolean(customization.titleRgb),
    titlePastel: Boolean(customization.titlePastel)
  };
}

function normalizeRoomGame(game) {
  if (!game || typeof game !== "object") {
    return null;
  }

  let setup = null;
  if (game.setup && typeof game.setup === "object") {
    try {
      const serialized = JSON.stringify(game.setup);
      if (serialized.length <= 250000) {
        setup = JSON.parse(serialized);
      }
    } catch {
      setup = null;
    }
  }
  const matchSettings = game.matchSettings && typeof game.matchSettings === "object"
    ? normalizeRoomGameSettings(game.matchSettings)
    : game.settings && typeof game.settings === "object"
      ? normalizeRoomGameSettings(game.settings)
      : null;
  const roundResult = game.roundResult && typeof game.roundResult === "object"
    ? normalizeRoomRoundResult(game.roundResult)
    : null;

  return {
    matchId: String(game.matchId || "").slice(0, 80),
    status: String(game.status || "playing").slice(0, 32),
    round: clampServerNumber(game.round, 1, 100, 1),
    setup,
    matchSettings,
    roundResult,
    answers: normalizeRoomAnswerState(game.answers, game.matchId, game.round),
    powerState: normalizeRoomPowerState(game.powerState),
    setupStartedAt: clampServerNumber(game.setupStartedAt || game.preparingStartedAt, 0, Number.MAX_SAFE_INTEGER, 0),
    roundStartedAt: clampServerNumber(game.roundStartedAt || game.startedAt, 0, Number.MAX_SAFE_INTEGER, 0),
    baseDurationMs: clampServerNumber(game.baseDurationMs, 5000, 60000, getRoomBaseTimerDurationMs(matchSettings || game.settings || {}, {})),
    participantTimers: normalizeRoomParticipantTimers(game.participantTimers),
    gradingStartedAt: clampServerNumber(game.gradingStartedAt, 0, Number.MAX_SAFE_INTEGER, 0),
    gradingReason: String(game.gradingReason || "").slice(0, 60),
    gradingForceAt: clampServerNumber(game.gradingForceAt, 0, Number.MAX_SAFE_INTEGER, 0),
    updatedAt: clampServerNumber(game.updatedAt, 0, Number.MAX_SAFE_INTEGER, Date.now())
  };
}

function normalizeRoomAnswerState(answers = {}, matchId = "", round = 0) {
  const source = answers && typeof answers === "object" ? answers : {};
  const normalizedMatchId = String(matchId || "").slice(0, 80);
  const normalizedRound = clampServerNumber(round, 0, 100, 0);
  return Object.fromEntries(
    Object.entries(source)
      .map(([participantId, answerState]) => {
        const id = String(participantId || answerState?.participantId || "").slice(0, 80);
        if (!id || !answerState || typeof answerState !== "object") {
          return null;
        }
        const status = String(answerState.status || "submitted").toLowerCase() === "timed_out"
          ? "timed_out"
          : "submitted";
        return [
          id,
          {
            participantId: id,
            status,
            answer: String(answerState.answer || "").slice(0, 500),
            submittedAt: clampServerNumber(answerState.submittedAt || answerState.updatedAt, 0, Number.MAX_SAFE_INTEGER, Date.now()),
            autoSubmitted: Boolean(answerState.autoSubmitted || status === "timed_out"),
            remainingTime: clampServerNumber(answerState.remainingTime, 0, 600, 0),
            matchId: String(answerState.matchId || normalizedMatchId).slice(0, 80),
            round: clampServerNumber(answerState.round || normalizedRound, 0, 100, normalizedRound)
          }
        ];
      })
      .filter(Boolean)
      .slice(-20)
  );
}

function normalizeRoomRoundResultSummaryText(value, maxLength = 240) {
  return String(value || "")
    .replace(/\s*\n+\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function normalizeRoomRoundResultSummary(summary) {
  if (!summary || typeof summary !== "object") {
    return null;
  }
  try {
    if (JSON.stringify(summary).length > 100000) {
      return null;
    }
  } catch {
    return null;
  }
  const judgements = (Array.isArray(summary.judgements) ? summary.judgements : [])
    .map((entry) => {
      const source = entry && typeof entry === "object" ? entry : {};
      const participantId = String(source.participantId || "").slice(0, 120);
      const owner = String(source.owner || "").slice(0, 80);
      const index = clampServerNumber(source.index ?? source.cardIndex, 0, 9, -1);
      if (index < 0 && !participantId && !owner) {
        return null;
      }
      return {
        index,
        participantId,
        owner,
        answer: normalizeRoomRoundResultSummaryText(source.answer, 500),
        correct: Boolean(source.correct),
        tag: normalizeRoomRoundResultSummaryText(source.tag, 48),
        bonus: Math.round(clampServerNumber(source.bonus, -1000000, 1000000, 0)),
        reason: normalizeRoomRoundResultSummaryText(source.reason || source.justification, 280),
        aiReviewed: Boolean(source.aiReviewed),
        aiSecondOpinion: Boolean(source.aiSecondOpinion)
      };
    })
    .filter(Boolean)
    .slice(0, 10);
  const scoreDeltas = (Array.isArray(summary.scoreDeltas) ? summary.scoreDeltas : [])
    .map((entry) => {
      const source = entry && typeof entry === "object" ? entry : {};
      const participantId = String(source.participantId || "").slice(0, 120);
      const owner = String(source.owner || "").slice(0, 80);
      if (!participantId && !owner) {
        return null;
      }
      return {
        participantId,
        owner,
        label: normalizeRoomRoundResultSummaryText(source.label, 32),
        delta: Math.round(clampServerNumber(source.delta, -1000000000, 1000000000, 0)),
        scoreBefore: Math.round(clampServerNumber(source.scoreBefore, 0, Number.MAX_SAFE_INTEGER, 0)),
        scoreAfter: Math.round(clampServerNumber(source.scoreAfter, 0, Number.MAX_SAFE_INTEGER, 0)),
        streakBefore: Math.round(clampServerNumber(source.streakBefore, 0, Number.MAX_SAFE_INTEGER, 0)),
        streakAfter: Math.round(clampServerNumber(source.streakAfter, 0, Number.MAX_SAFE_INTEGER, 0)),
        streakDelta: Math.round(clampServerNumber(source.streakDelta, -1000000, 1000000, 0)),
        correct: Boolean(source.correct),
        tag: normalizeRoomRoundResultSummaryText(source.tag, 48)
      };
    })
    .filter(Boolean)
    .slice(0, 10);
  const leaderboard = (Array.isArray(summary.leaderboard) ? summary.leaderboard : [])
    .map((entry, index) => {
      const source = entry && typeof entry === "object" ? entry : {};
      const participantId = String(source.participantId || "").slice(0, 120);
      const owner = String(source.owner || "").slice(0, 80);
      if (!participantId && !owner) {
        return null;
      }
      return {
        rank: Math.round(clampServerNumber(source.rank, 1, 10, index + 1)),
        participantId,
        owner,
        label: normalizeRoomRoundResultSummaryText(source.label, 32),
        score: Math.round(clampServerNumber(source.score, 0, Number.MAX_SAFE_INTEGER, 0)),
        displayScore: normalizeRoomRoundResultSummaryText(source.displayScore, 40),
        hiddenScore: Boolean(source.hiddenScore),
        streak: Math.round(clampServerNumber(source.streak, 0, Number.MAX_SAFE_INTEGER, 0)),
        delta: Math.round(clampServerNumber(source.delta, -1000000000, 1000000000, 0)),
        correct: Boolean(source.correct),
        tag: normalizeRoomRoundResultSummaryText(source.tag, 48)
      };
    })
    .filter(Boolean)
    .slice(0, 10);
  const powerEvents = (Array.isArray(summary.powerEvents) ? summary.powerEvents : [])
    .map((entry) => {
      if (typeof entry === "string") {
        const text = normalizeRoomRoundResultSummaryText(entry, 320);
        return text ? { text, owner: "", participantId: "", powerId: "", rarity: "", name: "", secret: false, chaosInfused: false } : null;
      }
      const source = entry && typeof entry === "object" ? entry : {};
      const text = normalizeRoomRoundResultSummaryText(source.text, 320);
      if (!text) {
        return null;
      }
      return {
        owner: String(source.owner || "").slice(0, 80),
        participantId: String(source.participantId || "").slice(0, 120),
        powerId: String(source.powerId || "").slice(0, 80),
        rarity: String(source.rarity || "").slice(0, 24),
        name: normalizeRoomRoundResultSummaryText(source.name, 80),
        text,
        secret: Boolean(source.secret),
        chaosInfused: Boolean(source.chaosInfused)
      };
    })
    .filter(Boolean)
    .slice(0, 40);
  const activeEffects = (Array.isArray(summary.activeEffects) ? summary.activeEffects : [])
    .map((entry) => {
      const source = entry && typeof entry === "object" ? entry : {};
      const owner = String(source.owner || "").slice(0, 80);
      const name = normalizeRoomRoundResultSummaryText(source.name, 80);
      if (!owner && !name) {
        return null;
      }
      return {
        owner,
        participantId: String(source.participantId || "").slice(0, 120),
        label: normalizeRoomRoundResultSummaryText(source.label, 32),
        name,
        description: normalizeRoomRoundResultSummaryText(source.description, 320),
        rarity: String(source.rarity || "").slice(0, 24),
        powerId: String(source.powerId || "").slice(0, 80),
        chaosInfused: Boolean(source.chaosInfused),
        private: Boolean(source.private)
      };
    })
    .filter(Boolean)
    .slice(0, 40);

  if (!judgements.length && !scoreDeltas.length && !leaderboard.length && !powerEvents.length && !activeEffects.length) {
    return null;
  }
  return {
    judgements,
    scoreDeltas,
    leaderboard,
    powerEvents,
    activeEffects
  };
}

function normalizeRoomRoundResult(result) {
  if (!result || typeof result !== "object") {
    return null;
  }
  const cards = Array.isArray(result.cards)
    ? result.cards.map((card) => String(card || "").trim().slice(0, 500)).slice(0, 10)
    : [];
  if (!cards.length) {
    return null;
  }
  const winnerIndex = clampServerNumber(result.winnerIndex ?? result.winner?.index, 0, Math.max(cards.length - 1, 0), 0);
  const correctIndexes = Array.isArray(result.correctIndexes)
    ? [...new Set(result.correctIndexes.map((index) => clampServerNumber(index, 0, cards.length - 1, -1)).filter((index) => index >= 0))]
    : [];
  const revealAnswerIndex = clampServerNumber(result.revealAnswerIndex, 0, Math.max(cards.length - 1, 0), winnerIndex);
  const powerState = result.powerState && typeof result.powerState === "object"
    ? normalizeRoomPowerState(result.powerState)
    : null;
  const scoreState = Array.isArray(result.scoreState)
    ? result.scoreState.map((entry) => {
      const source = entry && typeof entry === "object" ? entry : {};
      return {
        participantId: String(source.participantId || "").slice(0, 120),
        owner: String(source.owner || "").slice(0, 80),
        score: clampServerNumber(source.score, 0, Number.MAX_SAFE_INTEGER, 0),
        streak: clampServerNumber(source.streak, 0, Number.MAX_SAFE_INTEGER, 0)
      };
    }).filter((entry) => entry.participantId).slice(0, 10)
    : [];
  const aiReviewedIndexes = Array.isArray(result.aiReviewedIndexes)
    ? [...new Set(result.aiReviewedIndexes.map((index) => clampServerNumber(index, 0, cards.length - 1, -1)).filter((index) => index >= 0))]
    : [];
  const aiSecondOpinionIndexes = Array.isArray(result.aiSecondOpinionIndexes)
    ? [...new Set(result.aiSecondOpinionIndexes.map((index) => clampServerNumber(index, 0, cards.length - 1, -1)).filter((index) => index >= 0))]
    : [];
  return {
    matchId: String(result.matchId || "").slice(0, 80),
    round: clampServerNumber(result.round, 1, 100, 1),
    questionId: String(result.questionId || "").slice(0, 120),
    cards,
    winner: { index: winnerIndex },
    winnerIndex,
    correctIndexes,
    aiReviewedIndexes,
    aiSecondOpinionIndexes,
    revealAnswerIndex,
    winnerParticipantId: String(result.winnerParticipantId || "").slice(0, 120),
    revealParticipantId: String(result.revealParticipantId || result.winnerParticipantId || "").slice(0, 120),
    winningParticipantIds: Array.isArray(result.winningParticipantIds)
      ? [...new Set(result.winningParticipantIds.map((id) => String(id || "").slice(0, 120)).filter(Boolean))].slice(0, 10)
      : [],
    damagedParticipantIds: Array.isArray(result.damagedParticipantIds)
      ? [...new Set(result.damagedParticipantIds.map((id) => String(id || "").slice(0, 120)).filter(Boolean))].slice(0, 10)
      : Array.isArray(result.awarded?.damagedParticipantIds)
        ? [...new Set(result.awarded.damagedParticipantIds.map((id) => String(id || "").slice(0, 120)).filter(Boolean))].slice(0, 10)
        : [],
    cardCustomization: normalizeCardCustomization(result.cardCustomization),
    awarded: normalizeRoomRoundAward(result.awarded),
    powerState,
    scoreState,
    resultSummary: normalizeRoomRoundResultSummary(result.resultSummary),
    source: String(result.source || "host").slice(0, 40),
    nextRoundAt: clampServerNumber(result.nextRoundAt, 0, Number.MAX_SAFE_INTEGER, 0),
    updatedAt: clampServerNumber(result.updatedAt, 0, Number.MAX_SAFE_INTEGER, Date.now())
  };
}

function normalizeRoomRoundAward(awarded) {
  if (!awarded || typeof awarded !== "object") {
    return null;
  }
  try {
    const serialized = JSON.stringify(awarded);
    if (serialized.length > 80000) {
      return null;
    }
    return JSON.parse(serialized);
  } catch {
    return null;
  }
}

function normalizeRoomGameSettings(settings = {}) {
  const source = settings && typeof settings === "object" ? settings : {};
  const classicMode = Boolean(source.classicMode);
  const enabledThemes = Array.isArray(source.enabledThemes)
    ? source.enabledThemes.map((theme) => String(theme).trim()).filter((theme) => triviaThemes.includes(theme)).slice(0, triviaThemes.length)
    : [];
  return {
    rounds: clampServerNumber(source.rounds, 1, 10, 10),
    timerSeconds: clampServerNumber(source.timerSeconds, 10, 60, 30),
    maxPlayers: clampServerNumber(source.maxPlayers, 2, 10, 5),
    harsh: classicMode ? false : Boolean(source.harsh),
    chaos: classicMode ? false : Boolean(source.chaos),
    timeMoney: classicMode ? false : Boolean(source.timeMoney),
    amplified: classicMode ? false : Boolean(source.amplified),
    wildFire: classicMode ? false : Boolean(source.wildFire),
    partyMayhem: classicMode ? false : Boolean(source.partyMayhem),
    classicMode,
    randomModifiers: classicMode ? false : Boolean(source.randomModifiers),
    autoAdvance: source.autoAdvance !== false,
    enabledThemes: enabledThemes.length ? enabledThemes : [...triviaThemes]
  };
}

function normalizeRoomPowerState(powerState) {
  if (!powerState || typeof powerState !== "object") {
    return null;
  }
  const hands = Array.isArray(powerState.hands) ? powerState.hands : [];
  return {
    matchId: String(powerState.matchId || "").slice(0, 80),
    revision: clampServerNumber(powerState.revision || powerState.powerRevision, 0, Number.MAX_SAFE_INTEGER, 0),
    updatedAt: clampServerNumber(powerState.updatedAt, 0, Number.MAX_SAFE_INTEGER, Date.now()),
    hands: hands
      .map((entry) => {
        const source = entry && typeof entry === "object" ? entry : {};
        return {
          participantId: String(source.participantId || "").slice(0, 120),
          owner: String(source.owner || "").slice(0, 80),
          revision: clampServerNumber(source.revision, 0, Number.MAX_SAFE_INTEGER, 0),
          updatedAt: clampServerNumber(source.updatedAt, 0, Number.MAX_SAFE_INTEGER, powerState.updatedAt || Date.now()),
          hand: Array.isArray(source.hand)
            ? source.hand.map((powerId) => String(powerId || "").slice(0, 80)).filter(Boolean).slice(0, 10)
            : [],
          fresh: Array.isArray(source.fresh)
            ? source.fresh.map((powerId) => String(powerId || "").slice(0, 80)).filter(Boolean).slice(0, 10)
            : []
        };
      })
      .filter((entry) => entry.participantId)
      .slice(0, 10),
    played: (Array.isArray(powerState.played) ? powerState.played : [])
      .map((entry) => {
        const source = entry && typeof entry === "object" ? entry : {};
        return {
          participantId: String(source.participantId || "").slice(0, 120),
          owner: String(source.owner || "").slice(0, 80),
          revision: clampServerNumber(source.revision, 0, Number.MAX_SAFE_INTEGER, 0),
          updatedAt: clampServerNumber(source.updatedAt, 0, Number.MAX_SAFE_INTEGER, powerState.updatedAt || Date.now()),
          stacks: (Array.isArray(source.stacks) ? source.stacks : [])
            .map((stack) => {
              const stackSource = stack && typeof stack === "object" ? stack : {};
              return {
                powerId: String(stackSource.powerId || "").slice(0, 80),
                revealId: String(stackSource.revealId || "").slice(0, 120),
                meta: stackSource.meta && typeof stackSource.meta === "object" ? stackSource.meta : {}
              };
            })
            .filter((stack) => stack.powerId)
            .slice(0, 10),
          primaryPowerId: String(source.primaryPowerId || "").slice(0, 80),
          meta: source.meta && typeof source.meta === "object" ? source.meta : null
        };
      })
      .filter((entry) => entry.participantId)
      .slice(0, 10),
    players: (Array.isArray(powerState.players) ? powerState.players : [])
      .map((entry) => {
        const source = entry && typeof entry === "object" ? entry : {};
        return {
          participantId: String(source.participantId || "").slice(0, 120),
          owner: String(source.owner || "").slice(0, 80),
          revision: clampServerNumber(source.revision, 0, Number.MAX_SAFE_INTEGER, 0),
          updatedAt: clampServerNumber(source.updatedAt, 0, Number.MAX_SAFE_INTEGER, powerState.updatedAt || Date.now()),
          score: clampServerNumber(source.score, 0, Number.MAX_SAFE_INTEGER, 0),
          streak: clampServerNumber(source.streak, 0, Number.MAX_SAFE_INTEGER, 0)
        };
      })
      .filter((entry) => entry.participantId)
      .slice(0, 10),
    effects: normalizeRoomAbilityEffects(powerState.effects)
  };
}

function getRoomPowerStateRevision(powerState) {
  return clampServerNumber(powerState?.revision || powerState?.powerRevision, 0, Number.MAX_SAFE_INTEGER, 0);
}

function stripClientPowerStateRevisions(powerState) {
  const normalized = normalizeRoomPowerState(powerState);
  if (!normalized) {
    return null;
  }
  const clearEntry = (entry) => ({
    ...entry,
    revision: 0
  });
  return {
    ...normalized,
    revision: 0,
    hands: normalized.hands.map(clearEntry),
    played: normalized.played.map(clearEntry),
    players: normalized.players.map(clearEntry)
  };
}

function getRoomGameplayParticipantIdSet(room) {
  return new Set((Array.isArray(room?.participants) ? room.participants : [])
    .filter(isGameplayParticipant)
    .map((participant) => String(participant.id || "").slice(0, 120))
    .filter(Boolean));
}

function filterRoomPowerStateParticipants(powerState, room) {
  const normalized = normalizeRoomPowerState(powerState);
  if (!normalized) {
    return null;
  }
  const gameplayParticipantIds = getRoomGameplayParticipantIdSet(room);
  if (!gameplayParticipantIds.size) {
    return {
      ...normalized,
      hands: [],
      played: [],
      players: []
    };
  }
  return {
    ...normalized,
    hands: normalized.hands.filter((entry) => gameplayParticipantIds.has(entry.participantId)),
    played: normalized.played.filter((entry) => gameplayParticipantIds.has(entry.participantId)),
    players: normalized.players.filter((entry) => gameplayParticipantIds.has(entry.participantId))
  };
}

function shouldAcceptPowerStateEntry(previous, next) {
  if (!next?.participantId) {
    return false;
  }
  if (!previous) {
    return true;
  }
  const previousRevision = clampServerNumber(previous.revision, 0, Number.MAX_SAFE_INTEGER, 0);
  const nextRevision = clampServerNumber(next.revision, 0, Number.MAX_SAFE_INTEGER, 0);
  if (nextRevision && previousRevision && nextRevision !== previousRevision) {
    return nextRevision > previousRevision;
  }
  if (nextRevision && !previousRevision) {
    return true;
  }
  const previousUpdatedAt = Number(previous.updatedAt) || 0;
  const nextUpdatedAt = Number(next.updatedAt) || 0;
  return nextUpdatedAt >= previousUpdatedAt;
}

function getPowerStateEntryMap(entries = []) {
  const map = new Map();
  (Array.isArray(entries) ? entries : []).forEach((entry) => {
    const participantId = String(entry?.participantId || "").slice(0, 120);
    if (participantId) {
      map.set(participantId, entry);
    }
  });
  return map;
}

function getAcceptedPowerStateParticipantIds(previousEntries = [], nextEntries = []) {
  const previousByParticipantId = getPowerStateEntryMap(previousEntries);
  return new Set((Array.isArray(nextEntries) ? nextEntries : [])
    .filter((entry) => shouldAcceptPowerStateEntry(previousByParticipantId.get(entry.participantId), entry))
    .map((entry) => entry.participantId));
}

function mergePowerStateEntries(previousEntries = [], nextEntries = []) {
  const byParticipantId = new Map();
  previousEntries.forEach((entry) => {
    if (entry?.participantId) {
      byParticipantId.set(entry.participantId, entry);
    }
  });
  nextEntries.forEach((entry) => {
    if (entry?.participantId) {
      const previous = byParticipantId.get(entry.participantId);
      if (shouldAcceptPowerStateEntry(previous, entry)) {
        byParticipantId.set(entry.participantId, entry);
      }
    }
  });
  return [...byParticipantId.values()].slice(0, 10);
}

function stampRoomPowerStateServerRevision(previousPowerState, nextPowerState, mergedPowerState, revision) {
  const previous = normalizeRoomPowerState(previousPowerState) || { hands: [], played: [], players: [] };
  const next = normalizeRoomPowerState(nextPowerState) || { hands: [], played: [], players: [] };
  const merged = normalizeRoomPowerState(mergedPowerState);
  if (!merged) {
    return null;
  }
  const serverRevision = clampServerNumber(
    revision,
    0,
    Number.MAX_SAFE_INTEGER,
    getRoomPowerStateRevision(previous) + 1
  );
  const stampEntries = (kind) => {
    const acceptedIds = getAcceptedPowerStateParticipantIds(previous[kind], next[kind]);
    const previousByParticipantId = getPowerStateEntryMap(previous[kind]);
    return (Array.isArray(merged[kind]) ? merged[kind] : []).map((entry) => {
      const previousEntry = previousByParticipantId.get(entry.participantId);
      return {
        ...entry,
        revision: acceptedIds.has(entry.participantId)
          ? serverRevision
          : getRoomPowerStateRevision(previousEntry)
      };
    });
  };
  return {
    ...merged,
    revision: serverRevision,
    updatedAt: Math.max(Number(merged.updatedAt) || 0, Date.now()),
    hands: stampEntries("hands"),
    played: stampEntries("played"),
    players: stampEntries("players")
  };
}

function mergeRoomPowerState(previousPowerState, nextPowerState) {
  const previous = normalizeRoomPowerState(previousPowerState) || {
    revision: 0,
    updatedAt: 0,
    hands: [],
    played: [],
    players: [],
    effects: null
  };
  const next = normalizeRoomPowerState(nextPowerState);
  if (!next) {
    return previous;
  }
  return {
    matchId: next.matchId || previous.matchId || "",
    revision: Math.max(getRoomPowerStateRevision(previous), getRoomPowerStateRevision(next)),
    updatedAt: Math.max(previous.updatedAt || 0, next.updatedAt || Date.now()),
    hands: mergePowerStateEntries(previous.hands, next.hands),
    played: mergePowerStateEntries(previous.played, next.played),
    players: mergePowerStateEntries(previous.players, next.players),
    effects: next.effects || previous.effects || null
  };
}

function normalizeRoomAbilityEffects(effects) {
  if (!effects || typeof effects !== "object") {
    return null;
  }
  try {
    const serialized = JSON.stringify(effects);
    if (serialized.length > 120000) {
      return null;
    }
    return JSON.parse(serialized);
  } catch {
    return null;
  }
}

function finalizeRoom(room) {
  room.banned = Array.isArray(room.banned) ? room.banned.map((entry) => String(entry).slice(0, 140)).filter(Boolean) : [];
  const participantById = new Map();
  room.participants.forEach((participant) => {
    const role = normalizeParticipantRole(participant);
    const normalizedParticipant = {
      ...participant,
      role,
      userId: participant.userId || participant.profileUserId || participant.id,
      host: role === "host",
      bot: role === "bot",
      spectator: role === "spectator",
      active: participant.active !== false
    };
    if (!room.banned.includes(normalizedParticipant.id) && !room.banned.includes(normalizedParticipant.name) && !room.banned.includes(normalizedParticipant.profileUserId)) {
      participantById.set(normalizedParticipant.id, normalizedParticipant);
    }
  });
  room.participants = [...participantById.values()];
  const activeHosts = room.participants.filter((participant) => normalizeParticipantRole(participant) === "host" && participant.active !== false);
  if (activeHosts.length > 1) {
    const preferredHost = activeHosts.find((participant) => participant.id === room.host?.id) || activeHosts.at(-1);
    const staleHostIds = new Set(activeHosts.filter((participant) => participant.id !== preferredHost.id).map((participant) => participant.id));
    room.participants = room.participants.filter((participant) => !staleHostIds.has(participant.id));
  }
  if (!room.participants.some((participant) => normalizeParticipantRole(participant) === "host")) {
    const repairedHost = {
      id: room.host.id,
      userId: room.host.profileUserId || room.host.id,
      profileUserId: room.host.profileUserId || room.host.id,
      name: room.host.name,
      avatar: room.host.avatar,
      equippedTitleId: room.host.equippedTitleId || "",
      specialBadges: normalizeSpecialBadges(room.host.specialBadges),
      cardCustomization: room.host.cardCustomization || null,
      role: "host",
      host: true,
      spectator: false,
      bot: false,
      active: room.status !== "complete",
      muted: false,
      status: "host",
      answer: "",
      submittedRound: 0,
      submissionMatchId: "",
      remainingTime: 0,
      disconnectedAt: 0,
      lastConnectedAt: 0,
      joinedAt: Date.now()
    };
    const existingHostIndex = room.participants.findIndex((participant) => participant.id === room.host.id);
    if (existingHostIndex >= 0) {
      room.participants[existingHostIndex] = {
        ...room.participants[existingHostIndex],
        ...repairedHost
      };
    } else {
      room.participants.unshift(repairedHost);
    }
  }
  room.activePlayers = room.participants.filter(isGameplayParticipant).length;
  room.spectators = room.participants.filter(isSpectatorParticipant).length;
  pruneRoomParticipantTokens(room);
}

function clampServerNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, number));
}

async function serveStatic(pathname, res, isHead, req) {
  const safePath = pathname === "/" ? "/index.html" : pathname;
  const filePath = normalize(join(root, safePath));

  if (!filePath.startsWith(root) || isForbiddenStaticPath(filePath)) {
    sendText(res, 403, "Forbidden");
    return;
  }

  try {
    const fileStats = await stat(filePath);
    if (!fileStats.isFile()) {
      if (isRoomInvitePath(pathname)) {
        await serveStatic("/", res, isHead, req);
        return;
      }
      sendText(res, 404, "Not found");
      return;
    }
    const contentType = mimeTypes[extname(filePath).toLowerCase()] || "application/octet-stream";
    const isMedia = contentType.startsWith("audio/");
    const range = isMedia ? req?.headers?.range : "";
    const cacheControl = getStaticCacheControl(filePath, contentType);
    const shouldGzip = shouldGzipStaticResponse(req, filePath, contentType, fileStats.size) && !range;
    const etag = `W/"${fileStats.size}-${Math.floor(fileStats.mtimeMs)}"`;
    const lastModified = fileStats.mtime.toUTCString();
    const commonHeaders = {
      ...getSecurityHeaders(),
      "Content-Type": contentType,
      "Cache-Control": cacheControl,
      "ETag": etag,
      "Last-Modified": lastModified,
      ...(isGzipCandidate(filePath, contentType) ? { "Vary": "Accept-Encoding" } : {}),
      ...(isMedia ? { "Accept-Ranges": "bytes" } : {})
    };

    const ifNoneMatch = String(req?.headers?.["if-none-match"] || "");
    const ifModifiedSince = Date.parse(String(req?.headers?.["if-modified-since"] || ""));
    const mtimeSecond = Math.floor(fileStats.mtimeMs / 1000) * 1000;
    if (!range && (ifNoneMatch === etag || (Number.isFinite(ifModifiedSince) && ifModifiedSince >= mtimeSecond))) {
      res.writeHead(304, commonHeaders);
      res.end();
      return;
    }

    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (match) {
        const requestedStart = match[1] ? Number(match[1]) : 0;
        const requestedEnd = match[2] ? Number(match[2]) : fileStats.size - 1;
        const start = Math.max(0, Math.min(fileStats.size - 1, requestedStart));
        const end = Math.max(start, Math.min(fileStats.size - 1, requestedEnd));
        const chunkLength = end - start + 1;
        res.writeHead(206, {
          ...commonHeaders,
          "Content-Length": chunkLength,
          "Content-Range": `bytes ${start}-${end}/${fileStats.size}`
        });
        if (!isHead) {
          createReadStream(filePath, { start, end }).pipe(res);
        } else {
          res.end();
        }
        return;
      }
    }

    const responseHeaders = shouldGzip
      ? { ...commonHeaders, "Content-Encoding": "gzip" }
      : { ...commonHeaders, "Content-Length": fileStats.size };
    res.writeHead(200, responseHeaders);
    if (!isHead) {
      const stream = createReadStream(filePath);
      if (shouldGzip) {
        stream.pipe(createGzip({ level: 6 })).pipe(res);
      } else {
        stream.pipe(res);
      }
    } else {
      res.end();
    }
  } catch {
    if (isRoomInvitePath(pathname)) {
      await serveStatic("/", res, isHead, req);
      return;
    }
    sendText(res, 404, "Not found");
  }
}

function isRoomInvitePath(pathname = "") {
  return /^\/(?:CAI-?)?\d{4}\/?$/i.test(String(pathname || ""));
}

function isForbiddenStaticPath(filePath) {
  const relativePath = filePath.slice(root.length).replace(/^[/\\]+/, "");
  const parts = relativePath.split(/[/\\]+/).filter(Boolean);
  const firstPart = parts[0] || "";
  const lastPart = parts.at(-1) || "";
  const blockedTopLevel = new Set(["api", "lib", "tests"]);
  const blockedFiles = new Set([
    ".env",
    ".env.local",
    ".env.production",
    ".env.development",
    ".gitignore",
    "package.json",
    "package-lock.json",
    "server.js",
    "supabase-user-storage.sql"
  ]);
  return parts.some((part) => part.startsWith("."))
    || blockedTopLevel.has(firstPart)
    || blockedFiles.has(lastPart);
}

function isGzipCandidate(filePath, contentType = "") {
  const extension = extname(filePath).toLowerCase();
  return contentType.startsWith("text/")
    || extension === ".js"
    || extension === ".json"
    || extension === ".svg"
    || extension === ".webmanifest"
    || extension === ".md";
}

function shouldGzipStaticResponse(req, filePath, contentType, size) {
  if (!isGzipCandidate(filePath, contentType) || Number(size) < 1024) {
    return false;
  }
  return String(req?.headers?.["accept-encoding"] || "").includes("gzip");
}

function getStaticCacheControl(filePath, contentType = "") {
  const extension = extname(filePath).toLowerCase();
  if (extension === ".html") {
    return "no-store";
  }
  if (extension === ".js" || extension === ".css") {
    return "public, max-age=21600, stale-while-revalidate=604800";
  }
  if (
    contentType.startsWith("audio/")
    || contentType.startsWith("image/")
    || extension === ".otf"
    || extension === ".ttf"
    || extension === ".woff"
    || extension === ".woff2"
  ) {
    return "public, max-age=2592000, immutable";
  }
  if (extension === ".json") {
    return "public, max-age=600, must-revalidate";
  }
  return "public, max-age=300, must-revalidate";
}

async function handleSetup(req, res) {
  try {
    const body = await readRequestJson(req);
    const recentBlackCards = Array.isArray(body.recentBlackCards) ? body.recentBlackCards.map(String).slice(-30) : [];
    const enabledThemes = normalizeEnabledThemes(body.enabledThemes);
    const preferredTheme = normalizePreferredTheme(body.preferredTheme, enabledThemes);
    const baseSeed = String(body.setupSeed || `${Date.now()}-${Math.random()}`).slice(0, 80);
    const backgroundMode = Boolean(body.backgroundMode);
    const round = clampServerNumber(body.round, 1, 100, 1);
    const totalRounds = clampServerNumber(body.totalRounds, 1, 100, 10);
    const result = await getSeedQuestionSetup({
      recentBlackCards,
      enabledThemes,
      preferredTheme,
      setupSeed: baseSeed,
      backgroundMode,
      round,
      totalRounds
    });
    if (!result) {
      throw new Error("No seed questions are available for the selected themes.");
    }
    sendJson(res, 200, result);
  } catch (error) {
    console.error(error);
    sendJson(res, 400, { error: error.message || "Round setup generation failed." });
  }
}

function normalizeEnabledThemes(themes) {
  const requested = Array.isArray(themes)
    ? themes.map((theme) => String(theme).trim()).filter((theme) => triviaThemes.includes(theme))
    : [];
  return requested.length ? requested : [...triviaThemes];
}

function normalizePreferredTheme(theme, enabledThemes) {
  const preferred = String(theme || "").trim();
  return enabledThemes.includes(preferred) ? preferred : "";
}

function loadQuestionBank() {
  const filePath = join(root, "data", "questions.json");
  if (!existsSync(filePath)) {
    return [];
  }

  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8"));
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.map(normalizeSeedQuestion).filter(Boolean);
  } catch (error) {
    console.warn("Could not load data/questions.json:", error.message || error);
    return [];
  }
}

async function getRuntimeQuestionBank() {
  const merged = new Map();
  questionBank.forEach((question) => {
    merged.set(normalizeQuestionText(question.id), question);
  });

  try {
    const submissions = await backendStore.listQuestionSubmissions();
    submissions
      .filter((submission) => submission.status === "approved")
      .forEach((submission) => {
        const normalized = normalizeSeedQuestion(submission.question);
        if (normalized) {
          merged.set(normalizeQuestionText(normalized.id), { ...normalized, source: "player" });
        }
      });
  } catch (error) {
    console.warn("Could not load approved player questions:", error.message || error);
  }

  try {
    const overrides = await backendStore.listQuestionOverrides();
    overrides.forEach((override) => {
      const normalizedId = normalizeQuestionText(override.id);
      if (!normalizedId) {
        return;
      }
      if (override.deleted) {
        merged.delete(normalizedId);
        return;
      }
      const normalized = normalizeSeedQuestion(override.question);
      if (normalized) {
        merged.set(normalizeQuestionText(normalized.id), { ...normalized, source: "debug" });
      }
    });
  } catch (error) {
    console.warn("Could not load debug question overrides:", error.message || error);
  }

  return [...merged.values()];
}

function normalizeSeedQuestion(question) {
  const source = question && typeof question === "object" ? question : {};
  const type = source.type === "image" ? "image" : "text";
  const questionStyle = source.questionStyle === "multiple-choice" || source.style === "multiple-choice" || source.type === "multiple-choice"
    ? "multiple-choice"
    : "standard";
  const gradingStrictness = normalizeGradingStrictness(source.gradingStrictness);
  const theme = triviaThemes.includes(source.theme) ? source.theme : "Pop Culture";
  const blackCard = String(source.question || source.blackCard || "").trim().replace(/\s+/g, " ").slice(0, 220);
  const canonicalAnswer = String(source.canonicalAnswer || "").trim().slice(0, 120);
  if (!blackCard || !canonicalAnswer) {
    return null;
  }

  const acceptedAnswers = Array.isArray(source.acceptedAnswers)
    ? source.acceptedAnswers.map((answer) => String(answer).trim().slice(0, 120)).filter(Boolean)
    : [];
  const rawBotCards = questionStyle === "multiple-choice"
    ? normalizeAnswerList(source.botCards, 3)
    : normalizeBotCards(source.botCards);
  const providedMultipleChoiceOptions = uniqueAnswers(
    Array.isArray(source.multipleChoiceOptions || source.options)
      ? (source.multipleChoiceOptions || source.options).map((answer) => String(answer).trim().slice(0, 120)).filter(Boolean)
      : []
  );
  const multipleChoiceOptions = questionStyle === "multiple-choice"
    ? uniqueAnswers([
      canonicalAnswer,
      ...providedMultipleChoiceOptions.filter((answer) => normalizeQuestionText(answer) !== normalizeQuestionText(canonicalAnswer)),
      ...rawBotCards.filter((answer) => normalizeQuestionText(answer) !== normalizeQuestionText(canonicalAnswer))
    ]).slice(0, 4)
    : [];
  if (questionStyle === "multiple-choice" && multipleChoiceOptions.length !== 4) {
    return null;
  }
  const botCards = questionStyle === "multiple-choice"
    ? multipleChoiceOptions.filter((answer) => normalizeQuestionText(answer) !== normalizeQuestionText(canonicalAnswer)).slice(0, 3)
    : rawBotCards;
  const botCorrectPool = uniqueAnswers([canonicalAnswer, ...acceptedAnswers]);
  const botWrongPool = uniqueAnswers(botCards).filter((answer) => {
    const accepted = [canonicalAnswer, ...acceptedAnswers].filter(Boolean);
    return !isAnswerCorrectByStrictness(answer, accepted, gradingStrictness);
  });
  const botAnswerPool = uniqueAnswers([
    ...botCorrectPool,
    ...(botWrongPool.length ? botWrongPool : botCards)
  ]);
  const image = source.image && typeof source.image === "object" ? source.image : {};

  return {
    id: String(source.id || `${theme}-${canonicalAnswer}`).trim().slice(0, 120),
    type,
    questionStyle,
    gradingStrictness,
    theme,
    difficulty: String(source.difficulty || "medium").trim().slice(0, 30),
    blackCard,
    image: type === "image"
      ? {
        url: String(image.url || "").trim(),
        alt: String(image.alt || "").trim(),
        credit: String(image.credit || "").trim()
      }
      : null,
    canonicalAnswer,
    acceptedAnswers: uniqueAnswers(acceptedAnswers).slice(0, 10),
    botCards: questionStyle === "multiple-choice"
      ? []
      : botCards.length === 2 ? botCards : createFallbackBotCards(canonicalAnswer),
    multipleChoiceOptions: questionStyle === "multiple-choice" && multipleChoiceOptions.length === 4
      ? multipleChoiceOptions
      : [],
    rejectedAnswers: Array.isArray(source.rejectedAnswers)
      ? source.rejectedAnswers.map((answer) => String(answer).trim().slice(0, 120)).filter(Boolean).slice(0, 12)
      : [],
    botCorrectPool,
    botWrongPool: botWrongPool.length ? botWrongPool : createFallbackBotCards(canonicalAnswer),
    botAnswerPool,
    source: "seed"
  };
}

function createFallbackBotCards(answer) {
  const fallback = ["Unknown", "Not sure"];
  return fallback.map((card) => card === answer ? "Maybe" : card);
}

function uniqueAnswers(answers) {
  const seen = new Set();
  return answers
    .map((answer) => String(answer).trim())
    .filter((answer) => {
      const key = normalizeQuestionText(answer);
      if (!answer || seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
}

function getBotCorrectChance(difficulty) {
  const normalized = normalizeQuestionText(difficulty);
  if (normalized.includes("easy")) {
    return 0.54;
  }
  if (normalized.includes("hard")) {
    return 0.28;
  }
  return 0.42;
}

function pickFromPool(pool, seed) {
  if (!pool.length) {
    return "";
  }
  return pool[Math.abs(hashString(seed)) % pool.length];
}

function pickBotAnswersForSetup(question, seed) {
  if (question.questionStyle === "multiple-choice") {
    return [];
  }
  const correctPool = uniqueAnswers(
    Array.isArray(question.botCorrectPool) && question.botCorrectPool.length
      ? question.botCorrectPool
      : [question.canonicalAnswer, ...(question.acceptedAnswers || [])]
  );
  const wrongPool = uniqueAnswers(
    Array.isArray(question.botWrongPool) && question.botWrongPool.length
      ? question.botWrongPool
      : question.botCards || []
  ).filter((answer) => !isAnswerCorrectByStrictness(answer, correctPool, question.gradingStrictness));
  const anyPool = uniqueAnswers([
    ...correctPool,
    ...wrongPool,
    ...(Array.isArray(question.botAnswerPool) ? question.botAnswerPool : [])
  ]);
  const picked = [];
  const chance = getBotCorrectChance(question.difficulty);

  for (let slot = 0; slot < 2; slot += 1) {
    const roll = (Math.abs(hashString(`${seed}-${question.id}-correct-${slot}`)) % 1000) / 1000;
    const preferredPool = roll < chance ? correctPool : wrongPool;
    const fallbackPool = roll < chance ? wrongPool : correctPool;
    const availablePreferred = preferredPool.filter((answer) => !picked.some((pickedAnswer) => normalizeQuestionText(pickedAnswer) === normalizeQuestionText(answer)));
    const availableFallback = fallbackPool.filter((answer) => !picked.some((pickedAnswer) => normalizeQuestionText(pickedAnswer) === normalizeQuestionText(answer)));
    const availableAny = anyPool.filter((answer) => !picked.some((pickedAnswer) => normalizeQuestionText(pickedAnswer) === normalizeQuestionText(answer)));
    const answer = pickFromPool(availablePreferred, `${seed}-${question.id}-pick-${slot}`)
      || pickFromPool(availableFallback, `${seed}-${question.id}-fallback-${slot}`)
      || pickFromPool(availableAny, `${seed}-${question.id}-any-${slot}`);
    if (answer) {
      picked.push(answer);
    }
  }

  return normalizeBotCards(picked);
}

function isMultipleChoiceQuestion(question) {
  return question?.questionStyle === "multiple-choice" && Array.isArray(question.multipleChoiceOptions) && question.multipleChoiceOptions.length === 4;
}

function shuffleQuestionOptions(options, seed) {
  return [...options]
    .map((option, index) => ({ option, rank: Math.abs(hashString(`${seed}-${option}-${index}`)) }))
    .sort((a, b) => a.rank - b.rank)
    .map((entry) => entry.option);
}

function getMultipleChoiceChancePercent(round, totalRounds) {
  const cleanTotalRounds = Math.max(1, Math.floor(Number(totalRounds) || 1));
  const cleanRound = Math.min(cleanTotalRounds, Math.max(1, Math.floor(Number(round) || 1)));
  if (cleanTotalRounds <= 1 || cleanRound >= cleanTotalRounds) {
    return 0;
  }
  return 30 * ((cleanTotalRounds - cleanRound) / (cleanTotalRounds - 1));
}

async function getSeedQuestionSetup(options = {}) {
  const enabledThemes = normalizeEnabledThemes(options.enabledThemes);
  const preferredTheme = normalizePreferredTheme(options.preferredTheme, enabledThemes);
  const recentBlackCards = Array.isArray(options.recentBlackCards) ? options.recentBlackCards : [];
  const seed = String(options.setupSeed || `${Date.now()}-${Math.random()}`);
  const multipleChoiceChancePercent = getMultipleChoiceChancePercent(options.round, options.totalRounds);
  const runtimeQuestionBank = await getRuntimeQuestionBank();
  const preferredPool = preferredTheme
    ? runtimeQuestionBank.filter((question) => question.theme === preferredTheme && !isRepeatedQuestion(question.blackCard, recentBlackCards))
    : [];
  const broadPool = runtimeQuestionBank.filter((question) => enabledThemes.includes(question.theme) && !isRepeatedQuestion(question.blackCard, recentBlackCards));
  const fallbackPool = runtimeQuestionBank.filter((question) => enabledThemes.includes(question.theme));
  const pool = preferredPool.length ? preferredPool : broadPool.length ? broadPool : fallbackPool;
  if (!pool.length) {
    return null;
  }

  const multipleChoicePool = pool.filter(isMultipleChoiceQuestion);
  const standardPool = pool.filter((question) => !isMultipleChoiceQuestion(question));
  if (multipleChoiceChancePercent <= 0 && !standardPool.length) {
    return null;
  }
  const wantsMultipleChoice = multipleChoicePool.length
    && (Math.abs(hashString(`${seed}-question-style`)) % 10000) / 100 < multipleChoiceChancePercent;
  const pickPool = wantsMultipleChoice
    ? multipleChoicePool
    : standardPool.length ? standardPool : pool;
  const picked = pickPool[Math.abs(hashString(seed)) % pickPool.length];
  const setup = {
    type: picked.type,
    questionStyle: picked.questionStyle || "standard",
    gradingStrictness: normalizeGradingStrictness(picked.gradingStrictness),
    theme: picked.theme,
    difficulty: picked.difficulty,
    blackCard: picked.blackCard,
    image: picked.image ? { ...picked.image } : { url: "", alt: "", credit: "" },
    canonicalAnswer: picked.canonicalAnswer,
    acceptedAnswers: picked.acceptedAnswers,
    judge: getGenericJudge(),
    botCards: pickBotAnswersForSetup(picked, options.setupSeed),
    multipleChoiceOptions: isMultipleChoiceQuestion(picked)
      ? shuffleQuestionOptions(picked.multipleChoiceOptions, seed)
      : [],
    debug: {
      multipleChoiceChancePercent: Math.round(multipleChoiceChancePercent * 100) / 100,
      wantedMultipleChoice: Boolean(wantsMultipleChoice)
    },
    source: "seed",
    id: picked.id
  };

  if (picked.type === "image") {
    setup.image = await resolveSeedQuestionImage(setup, preferredTheme, { fast: Boolean(options.backgroundMode) });
  }

  return setup;
}

async function resolveSeedQuestionImage(setup, preferredTheme, options = {}) {
  const seedImage = setup.image && typeof setup.image === "object" ? setup.image : {};
  const directUrl = String(seedImage.url || "").trim();
  if (directUrl) {
    return withProxiedImageUrl({
      url: directUrl,
      alt: String(seedImage.alt || "").trim(),
      credit: String(seedImage.credit || "Seed bank").trim(),
      source: "seed"
    });
  }
  return createEmptyQuestionImage("No image URL saved for this question");
}

function normalizeQuestionText(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[_\W]+/g, " ")
    .trim();
}

function isRepeatedQuestion(question, recentQuestions) {
  const normalized = normalizeQuestionText(question);
  if (!normalized) {
    return true;
  }
  return recentQuestions.map(normalizeQuestionText).filter(Boolean).includes(normalized);
}

async function handleRound(req, res) {
  try {
    const body = await readRequestJson(req);
    const payload = normalizeRoundPayload(body);
    const roomAuth = await validateRoundRequestAuth(req, payload, body);
    if (!roomAuth.ok) {
      sendJson(res, roomAuth.status, { error: roomAuth.error });
      return;
    }
    const cacheKey = createAiRoundCacheKey(payload);
    const cached = await getAiRoundCache(cacheKey);
    if (cached) {
      sendJson(res, 200, cached);
      return;
    }

    const localResult = createLocalRoundResult(payload);
    const secondOpinionCandidates = getAiSecondOpinionCandidates(payload, localResult);
    const apiKey = getApiKey();
    if (!secondOpinionCandidates.length) {
      setAiRoundCache(cacheKey, localResult);
      sendJson(res, 200, localResult);
      return;
    }
    if (!apiKey) {
      sendJson(res, 200, localResult);
      return;
    }

    let result = localResult;
    try {
      result = await rememberAiRoundResult(cacheKey, async () => {
        const secondOpinion = await generateRoundSecondOpinionWithModel(payload, apiKey, secondOpinionCandidates);
        return mergeSecondOpinionRoundResult(localResult, secondOpinion, secondOpinionCandidates);
      });
    } catch (error) {
      console.warn("AI grading second opinion failed, using local trivia grader:", error.message || error);
      setAiRoundCache(cacheKey, result);
    }
    sendJson(res, 200, result);
  } catch (error) {
    console.error(error);
    sendJson(res, 400, { error: error.message || "Round generation failed." });
  }
}

function readRequestJson(req, options = {}) {
  const maxBytes = Number(options.maxBytes || 20_000);
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > maxBytes) {
        req.destroy();
        reject(new Error("Request too large."));
      }
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(raw || "{}"));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function normalizeRoundPayload(body) {
  const answer = String(body.answer || "").trim().slice(0, 80);
  const opponentAnswer = String(body.opponentAnswer || "").trim().slice(0, 80);
  const blackCard = String(body.blackCard || "").trim().slice(0, 300);
  const triviaTheme = String(body.triviaTheme || body.theme || "Mixed Trivia").trim().slice(0, 80);
  const canonicalAnswer = String(body.canonicalAnswer || "").trim().slice(0, 120);
  const acceptedAnswers = Array.isArray(body.acceptedAnswers)
    ? body.acceptedAnswers.map((entry) => String(entry).trim().slice(0, 120)).filter(Boolean).slice(0, 10)
    : [];
  const image = normalizeQuestionImage(body.image);
  const botCards = Array.isArray(body.botCards) ? body.botCards.map((card) => String(card).trim().slice(0, 140)).filter(Boolean).slice(0, 9) : [];
  const botLabels = Array.isArray(body.botLabels)
    ? body.botLabels.map((label) => String(label || "").trim().slice(0, 60)).filter(Boolean).slice(0, 9)
    : [];
  const answerCards = Array.isArray(body.answerCards)
    ? body.answerCards
      .map((card, index) => ({
        index,
        owner: String(card?.owner || "").trim().slice(0, 40),
        label: String(card?.label || `Player ${index + 1}`).trim().slice(0, 60),
        answer: String(card?.answer || "").trim().slice(0, 140)
      }))
      .slice(0, 10)
    : [];
  const matchContext = body.matchContext && typeof body.matchContext === "object" ? body.matchContext : {};
  const roundSeed = String(body.roundSeed || `${Date.now()}-${Math.random()}`).slice(0, 80);
  const mode = body.mode === "local" ? "local" : body.mode === "room" ? "room" : "bots";
  const roomCode = String(body.roomCode || body.code || "").trim().toUpperCase().slice(0, 12);
  const participantId = String(body.participantId || "").trim().slice(0, 80);
  const gradingStrictness = normalizeGradingStrictness(body.gradingStrictness);

  if (!blackCard) {
    throw new Error("Missing trivia question.");
  }
  if (mode === "room" && answerCards.length < 2) {
    throw new Error("Room grading needs at least two submitted answers.");
  }

  return {
    answer,
    opponentAnswer,
    blackCard,
    triviaTheme,
    canonicalAnswer,
    acceptedAnswers: acceptedAnswers.length ? acceptedAnswers : canonicalAnswer ? [canonicalAnswer] : [],
    gradingStrictness,
    image,
    mode,
    roomCode,
    participantId,
    botCards,
    botLabels,
    answerCards,
    matchContext: {
      playerScore: Number(matchContext.playerScore) || 0,
      opponentScore: Number(matchContext.opponentScore) || 0,
      playerWins: Number(matchContext.playerWins) || 0,
      opponentWins: Number(matchContext.opponentWins) || 0,
      round: Number(matchContext.round) || 1,
      maxRounds: Number(matchContext.maxRounds) || 5
    },
    roundSeed
  };
}

function getApiKey() {
  return process.env.AI_API_KEY || process.env.COMPUTINGER_API_KEY || process.env.OPENAI_API_KEY;
}

async function validateRoundRequestAuth(req, payload, body = {}) {
  if (payload.mode !== "room") {
    return { ok: true };
  }
  if (!/^CAI-\d{4}$/.test(payload.roomCode)) {
    return { ok: false, status: 400, error: "Room grading needs a valid room code." };
  }
  const room = await backendStore.getRoom(payload.roomCode);
  if (!room) {
    return { ok: false, status: 404, error: "Room not found." };
  }
  if (String(room.status || "") !== "in-progress") {
    return { ok: false, status: 409, error: "Room is not in progress." };
  }
  if (hasRoomHostAuth(req, room, body)) {
    return { ok: true };
  }
  if (!payload.participantId) {
    return { ok: false, status: 400, error: "Room grading needs a participant id." };
  }
  if (!hasRoomParticipantAuth(req, room, payload.participantId, body)) {
    return { ok: false, status: 403, error: "Only room participants can grade this round." };
  }
  return { ok: true };
}

function createAiRoundCacheKey(payload) {
  const stablePayload = {
    mode: payload.mode,
    roomCode: payload.roomCode,
    blackCard: payload.blackCard,
    triviaTheme: payload.triviaTheme,
    canonicalAnswer: payload.canonicalAnswer,
    acceptedAnswers: payload.acceptedAnswers,
    gradingStrictness: payload.gradingStrictness,
    imageUrl: payload.image?.url || "",
    answer: payload.answer,
    opponentAnswer: payload.opponentAnswer,
    botCards: payload.botCards,
    answerCards: payload.answerCards
      .map((card) => ({
        owner: card.owner,
        label: card.label,
        answer: card.answer
      }))
      .sort((a, b) => `${a.owner}:${a.label}`.localeCompare(`${b.owner}:${b.label}`))
  };
  return Buffer.from(JSON.stringify(stablePayload)).toString("base64url").slice(0, 512);
}

function getAiRoundCache(key) {
  const cached = aiRoundCache.get(key);
  if (!cached) {
    return null;
  }
  if (cached.expiresAt <= Date.now()) {
    aiRoundCache.delete(key);
    return null;
  }
  if (cached.promise) {
    return cached.promise;
  }
  return cached.result || null;
}

async function rememberAiRoundResult(key, producer) {
  const existing = getAiRoundCache(key);
  if (existing) {
    return existing;
  }
  const promise = Promise.resolve()
    .then(producer)
    .then((result) => {
      setAiRoundCache(key, result);
      return result;
    })
    .catch((error) => {
      aiRoundCache.delete(key);
      throw error;
    });
  aiRoundCache.set(key, { promise, expiresAt: Date.now() + aiRoundCacheTtlMs });
  pruneAiRoundCache();
  return promise;
}

function setAiRoundCache(key, result) {
  aiRoundCache.set(key, { result, expiresAt: Date.now() + aiRoundCacheTtlMs });
  pruneAiRoundCache();
}

function pruneAiRoundCache(now = Date.now()) {
  for (const [key, entry] of aiRoundCache.entries()) {
    if (entry.expiresAt <= now) {
      aiRoundCache.delete(key);
    }
  }
  while (aiRoundCache.size > aiRoundCacheMaxEntries) {
    const firstKey = aiRoundCache.keys().next().value;
    if (!firstKey) {
      break;
    }
    aiRoundCache.delete(firstKey);
  }
}

function getBaseUrl() {
  return (process.env.AI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/g, "");
}

function getModel() {
  return process.env.AI_MODEL || process.env.OPENAI_MODEL || "gpt-4.1-mini";
}

function getApiStyle() {
  if (process.env.AI_API_STYLE) {
    return process.env.AI_API_STYLE;
  }

  return getBaseUrl().includes("api.openai.com") ? "responses" : "chat";
}

function getGradingStrictnessInstruction(strictness) {
  switch (normalizeGradingStrictness(strictness)) {
    case "forgiving":
      return "Strictness is forgiving: count clear intent, common shorthand, phonetic spelling, and distinctive partial answers when the answer clearly points to the canonical answer.";
    case "strict":
      return "Strictness is strict: accept only specific, unambiguous answers. Minor spelling slips are fine, but vague partials and guesses that could mean something else should stay incorrect.";
    case "exact":
      return "Strictness is exact: accept only an exact normalized match to canonicalAnswer or one of acceptedAnswers. Do not rescue typos, partials, aliases, acronyms, or semantic equivalents unless they are explicitly listed.";
    case "normal":
    default:
      return "Strictness is normal: accept clear aliases, abbreviations, distinctive partial answers, and small spelling mistakes when the intended answer is obvious.";
  }
}

function buildRoundPrompt(payload) {
  const isLocal = payload.mode === "local";
  const isRoom = payload.mode === "room";
  const botLabels = Array.isArray(payload.botLabels) ? payload.botLabels.map((label) => String(label || "").trim()).filter(Boolean) : [];
  const submittedAnswers = isRoom
    ? payload.answerCards.map((card, index) => ({ index, label: card.label || `Player ${index + 1}`, answer: card.answer }))
    : isLocal
    ? [
      { index: 0, label: "Player 1", answer: payload.answer },
      { index: 1, label: "Player 2", answer: payload.opponentAnswer }
    ]
    : [
      { index: 0, label: "Player", answer: payload.answer },
      ...payload.botCards.map((answer, index) => ({ index: index + 1, label: botLabels[index] || `Bot ${index + 1}`, answer }))
    ];
  const isPlayerBehind =
    !isLocal &&
    !isRoom &&
    (payload.matchContext.opponentScore - payload.matchContext.playerScore >= 1000 ||
      payload.matchContext.opponentWins - payload.matchContext.playerWins >= 1);
  const isPlayerFarBehind =
    !isLocal &&
    !isRoom &&
    (payload.matchContext.opponentScore - payload.matchContext.playerScore >= 2000 ||
      payload.matchContext.opponentWins - payload.matchContext.playerWins >= 2);
  const providedAnswers = [payload.canonicalAnswer, ...payload.acceptedAnswers].filter(Boolean);
  return JSON.stringify({
    task: isRoom
      ? "Grade every multiplayer room participant's short trivia answer exactly as typed."
      : isLocal
      ? "Grade both local players' short trivia answers exactly as typed."
      : payload.botCards.length
        ? "Grade the player's short trivia answer exactly as typed and keep the provided bot guesses exactly as provided."
        : "Grade the player's short trivia answer exactly as typed and create plausible competing bot guesses.",
    outputShape: {
      cards: submittedAnswers.map((entry) => `${entry.label} answer`),
      winnerIndex: `internal scoring index from 0 to ${Math.max(0, submittedAnswers.length - 1)}`,
      correctIndexes: "array of every answer index that should be accepted as correct"
    },
    rules: [
      "Return only valid JSON. Do not wrap the JSON in markdown.",
      "Use submittedAnswers as the source of truth for every player/bot response. These answers are present and must be graded.",
      "Grade answers against the question and the intended meaning of canonicalAnswer. Treat acceptedAnswers as optional examples, not as the complete list of all valid answers.",
      getGradingStrictnessInstruction(payload.gradingStrictness),
      "Blank or empty answers are always incorrect and must never appear in correctIndexes.",
      "Use general trivia knowledge to accept semantically equivalent answers even when they are not listed in acceptedAnswers.",
      "Accept common aliases, nicknames, abbreviations, acronyms, translations, alternate spellings, swapped word order, missing accents, and minor spelling mistakes when the intended answer is clearly correct.",
      "Be deliberately forgiving with obvious typos and phonetic spellings: examples like 'Jackle' for 'Jackal', 'lui 14th' for 'Louis XIV', or 'vicent' for 'Vincent van Gogh' should be accepted when the intended answer is clear.",
      "Accept roman numerals, regular numbers, and ordinals as equivalent when they identify the same name/title/event, such as 'XIV', '14', and '14th'.",
      "Accept a distinctive partial answer when it clearly identifies the same thing as the canonical answer. This applies to all question types: people, places, teams, titles, objects, events, concepts, companies, artworks, games, and media. Do not require the full preset answer when the player gave enough information to identify it.",
      "Reject answers that are only a broad category, a generic adjective, a random related word, or too ambiguous to identify the canonical answer.",
      "Every cards[index] value must exactly match submittedAnswers[index].answer with no added words, flavor text, punctuation, or rewrite.",
      isRoom
        ? "Do not generate any extra bot guesses in room mode; only grade the submitted room answers."
        : isLocal
        ? "cards[1] must be exactly Player 2's raw answer with no added words, flavor text, punctuation, or rewrite."
        : payload.botCards.length
          ? `cards[1] through cards[${payload.botCards.length}] must exactly match the provided botCards in order. Do not rewrite or replace them.`
          : "Generate the bot cards as short plausible trivia guesses. At least one bot guess may be wrong, but all should look like real quiz answers.",
      `winnerIndex must be a valid submittedAnswers index from 0 to ${Math.max(0, submittedAnswers.length - 1)}. If nobody is correct, use 0 as a harmless placeholder.`,
      "correctIndexes must include every card index that is accepted as correct. It can contain multiple indexes. If nobody is fully correct, return an empty array.",
      "winnerIndex is only for internal scoring: set it to one accepted answer if correctIndexes is not empty; otherwise set it to 0 as a harmless placeholder.",
      isLocal || isRoom ? "Grade all submitted players evenly." : "Solo balance rule: bots should win when they are more correct, but a player answer with the same intended correct answer should not lose for capitalization, punctuation, abbreviation, or minor typo differences.",
      isLocal || isRoom ? "No comeback assist applies in this mode." : "Bots should not be rewarded for random weirdness. Correctness beats style.",
      isLocal || isRoom ? "For close calls, prefer the answer that is more factually correct, then more specific, then closer to the canonical answer." : "For close calls in solo mode, prefer the answer that is more factually correct, then more specific, then closer to the canonical answer; if those are tied, a correct player answer may win.",
      isPlayerFarBehind
        ? "Comeback assist is active because the player is far behind: if the player's answer is clearly correct and the decision is close, winnerIndex 0 is preferred."
        : isPlayerBehind
          ? "Light comeback assist is active because the player is behind: if the player's answer is clearly correct and the decision is extremely close, winnerIndex 0 is acceptable."
          : "Comeback assist is inactive. Pick the strongest card normally.",
      "Short answers are expected: usually 1-6 words.",
      "If multiple answers are correct, put all of them in correctIndexes, then choose the most exact or most specific answer as winnerIndex for this current single-winner UI.",
      "If no answer is fully correct, correctIndexes must be empty.",
      "Do not reuse any recent submitted answers as generated bot guesses.",
      isRoom
        ? "Do not generate bot cards in room mode."
        : isLocal
        ? "Do not generate bot cards in local mode."
        : payload.botCards.length
          ? "Use the provided bot cards as the bot competition."
          : "The bot cards must be independent plausible guesses, not derived from the player's raw answer.",
      isRoom ? "Grade each submittedAnswers entry under its label exactly." : isLocal ? "Grade submittedAnswers[0].answer exactly as Player 1 and submittedAnswers[1].answer exactly as Player 2." : "Grade submittedAnswers[0].answer exactly as the player response. If bot answers are provided in submittedAnswers, grade those exact bot responses.",
      "Do not include explanations, flavour text, jokes, commentary, or a grading report.",
      "Keep the JSON compact and suitable for fast quiz grading."
    ],
    randomness: {
      roundSeed: payload.roundSeed
    },
    submittedAnswers,
    providedBotCards: payload.botCards,
    trivia: {
      theme: payload.triviaTheme,
      question: payload.blackCard,
      canonicalAnswer: payload.canonicalAnswer,
      acceptedAnswers: providedAnswers,
      gradingStrictness: normalizeGradingStrictness(payload.gradingStrictness),
      image: payload.image
    },
    matchContext: payload.matchContext
  });
}

function hashString(value) {
  return String(value).split("").reduce((hash, char) => {
    const next = ((hash << 5) - hash) + char.charCodeAt(0);
    return next | 0;
  }, 0);
}

async function generateRoundWithModel(payload, apiKey) {
  if (getApiStyle() === "responses") {
    return generateRoundWithResponses(payload, apiKey);
  }

  return generateRoundWithChatCompletions(payload, apiKey);
}

function getExpectedRoundCardCount(payload) {
  if (payload.mode === "room") {
    return Math.max(2, Math.min(10, payload.answerCards?.length || 0));
  }
  if (payload.mode === "local") {
    return 2;
  }
  return 1 + Math.max(1, Math.min(9, payload.botCards?.length || 2));
}

async function generateRoundWithResponses(payload, apiKey) {
  const expectedCards = getExpectedRoundCardCount(payload);
  const response = await fetch(`${getBaseUrl()}/responses`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: getModel(),
      temperature: 0.35,
      input: [
        {
          role: "system",
          content:
            "You grade a short-answer trivia quiz. Accepted answer lists are examples, not exhaustive. Accept clear semantic equivalents, aliases, abbreviations, partial-but-identifying answers, missing accents, and spelling mistakes with swapped, missing, or extra letters when the intended answer is clear. Return only compact valid JSON matching the schema."
        },
        {
          role: "user",
          content: buildRoundPrompt(payload)
        }
      ],
      text: {
        format: {
          type: "json_schema",
          name: "card_round_result",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              cards: {
                type: "array",
                minItems: expectedCards,
                maxItems: expectedCards,
                items: {
                  type: "string",
                  minLength: 1,
                  maxLength: 140
                }
              },
              winnerIndex: {
                type: "integer",
                minimum: 0,
                maximum: Math.max(0, expectedCards - 1)
              },
              correctIndexes: {
                type: "array",
                minItems: 0,
                maxItems: expectedCards,
                items: {
                  type: "integer",
                  minimum: 0,
                  maximum: Math.max(0, expectedCards - 1)
                }
              },
            },
            required: ["cards", "winnerIndex", "correctIndexes"]
          }
        }
      }
    })
  });

  const data = await response.json();
  if (!response.ok) {
    const message = data.error && data.error.message ? data.error.message : "OpenAI request failed.";
    throw new Error(message);
  }

  const outputText = extractOutputText(data);
  const parsed = JSON.parse(outputText);
  return validateRoundResult(parsed, payload);
}

async function generateRoundWithChatCompletions(payload, apiKey) {
  const response = await fetch(`${getBaseUrl()}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: getModel(),
      temperature: 0.35,
      messages: [
        {
          role: "system",
          content:
            "You grade a short-answer trivia quiz. Accepted answer lists are examples, not exhaustive. Accept clear semantic equivalents, aliases, abbreviations, partial-but-identifying answers, missing accents, and spelling mistakes with swapped, missing, or extra letters when the intended answer is clear. Return only valid JSON with keys cards, winnerIndex, and correctIndexes."
        },
        {
          role: "user",
          content: buildRoundPrompt(payload)
        }
      ],
      response_format: {
        type: "json_object"
      }
    })
  });

  const data = await response.json();
  if (!response.ok) {
    const message = data.error && data.error.message ? data.error.message : "Model request failed.";
    throw new Error(message);
  }

  const outputText = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if (!outputText) {
    throw new Error("Chat completion did not include message content.");
  }

  const parsed = JSON.parse(stripJsonMarkdown(outputText));
  return validateRoundResult(parsed, payload);
}

async function generateRoundSecondOpinionWithModel(payload, apiKey, candidates = []) {
  if (getApiStyle() === "responses") {
    return generateRoundSecondOpinionWithResponses(payload, apiKey, candidates);
  }

  return generateRoundSecondOpinionWithChatCompletions(payload, apiKey, candidates);
}

function buildRoundSecondOpinionPrompt(payload, candidates = []) {
  return JSON.stringify({
    task: "Give a second opinion only for short trivia answers that the preset grader marked incorrect but close enough to review.",
    outputShape: {
      correctIndexes: "array of candidate indexes that should be accepted as correct"
    },
    rules: [
      "Return only valid JSON. Do not wrap the JSON in markdown.",
      "Only evaluate candidateAnswers. Do not include any index that is not listed in candidateAnswers.",
      getGradingStrictnessInstruction(payload.gradingStrictness),
      "Accept an answer only when it clearly identifies the canonical answer despite misspelling, missing accents, phonetic spelling, abbreviation, alias, swapped word order, translation, or a distinctive partial answer.",
      "A distinctive first name, surname, nickname, team name, title fragment, or object/place/company name can be correct when the question context makes the intended answer clear.",
      "Reject broad categories, random related words, guesses that point to a different answer, generic adjectives, jokes, filler, and ambiguous fragments.",
      "Blank, empty, nonsense, and gibberish answers are already filtered out and must not be accepted if present.",
      "If unsure, leave the index out.",
      "Do not include explanations, commentary, or rewritten answers."
    ],
    trivia: {
      theme: payload.triviaTheme,
      question: payload.blackCard,
      canonicalAnswer: payload.canonicalAnswer,
      acceptedAnswers: [payload.canonicalAnswer, ...payload.acceptedAnswers].filter(Boolean),
      gradingStrictness: normalizeGradingStrictness(payload.gradingStrictness),
      image: payload.image
    },
    candidateAnswers: candidates.map((candidate) => ({
      index: candidate.index,
      label: candidate.label,
      answer: candidate.answer,
      localScore: Math.round(candidate.score * 100) / 100
    }))
  });
}

async function generateRoundSecondOpinionWithResponses(payload, apiKey, candidates = []) {
  const response = await fetch(`${getBaseUrl()}/responses`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: getModel(),
      temperature: 0.1,
      input: [
        {
          role: "system",
          content:
            "You are a strict but forgiving second-opinion trivia grader. Accept only candidate answers that clearly mean the canonical answer despite spelling mistakes, aliases, abbreviations, or distinctive partial answers. Return only compact valid JSON."
        },
        {
          role: "user",
          content: buildRoundSecondOpinionPrompt(payload, candidates)
        }
      ],
      text: {
        format: {
          type: "json_schema",
          name: "trivia_second_opinion",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              correctIndexes: {
                type: "array",
                minItems: 0,
                maxItems: candidates.length,
                items: {
                  type: "integer",
                  minimum: 0,
                  maximum: Math.max(0, getExpectedRoundCardCount(payload) - 1)
                }
              }
            },
            required: ["correctIndexes"]
          }
        }
      }
    })
  });

  const data = await response.json();
  if (!response.ok) {
    const message = data.error && data.error.message ? data.error.message : "OpenAI second-opinion request failed.";
    throw new Error(message);
  }

  return validateSecondOpinionResult(JSON.parse(extractOutputText(data)), candidates);
}

async function generateRoundSecondOpinionWithChatCompletions(payload, apiKey, candidates = []) {
  const response = await fetch(`${getBaseUrl()}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: getModel(),
      temperature: 0.1,
      messages: [
        {
          role: "system",
          content:
            "You are a strict but forgiving second-opinion trivia grader. Accept only candidate answers that clearly mean the canonical answer despite spelling mistakes, aliases, abbreviations, or distinctive partial answers. Return only valid JSON with key correctIndexes."
        },
        {
          role: "user",
          content: buildRoundSecondOpinionPrompt(payload, candidates)
        }
      ],
      response_format: {
        type: "json_object"
      }
    })
  });

  const data = await response.json();
  if (!response.ok) {
    const message = data.error && data.error.message ? data.error.message : "Model second-opinion request failed.";
    throw new Error(message);
  }

  const outputText = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if (!outputText) {
    throw new Error("Chat completion did not include second-opinion content.");
  }

  return validateSecondOpinionResult(JSON.parse(stripJsonMarkdown(outputText)), candidates);
}

function validateSecondOpinionResult(result, candidates = []) {
  const candidateIndexes = new Set(candidates.map((candidate) => candidate.index));
  const correctIndexes = Array.isArray(result?.correctIndexes)
    ? [...new Set(result.correctIndexes.map(Number).filter((index) => Number.isInteger(index) && candidateIndexes.has(index)))]
    : [];
  return { correctIndexes };
}

function mergeSecondOpinionRoundResult(localResult, secondOpinion, candidates = []) {
  const candidateIndexes = new Set(candidates.map((candidate) => candidate.index));
  const rescuedIndexes = Array.isArray(secondOpinion?.correctIndexes)
    ? secondOpinion.correctIndexes.filter((index) => candidateIndexes.has(index))
    : [];
  const reviewedIndexes = [...candidateIndexes];
  const correctIndexes = [...new Set([...(localResult.correctIndexes || []), ...rescuedIndexes])]
    .filter((index) => Number.isInteger(index) && index >= 0 && index < localResult.cards.length);
  const winnerIndex = correctIndexes.includes(rescuedIndexes[0])
    ? rescuedIndexes[0]
    : correctIndexes.includes(localResult.winnerIndex)
      ? localResult.winnerIndex
      : correctIndexes[0] ?? 0;

  return {
    ...localResult,
    winnerIndex,
    correctIndexes,
    aiReviewedIndexes: reviewedIndexes,
    aiSecondOpinionIndexes: [...new Set(rescuedIndexes)],
    source: rescuedIndexes.length ? "local-with-ai-second-opinion" : "local-with-ai-review"
  };
}

function stripJsonMarkdown(text) {
  return text
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
}

function createLocalRoundResult(payload) {
  const expectedCards = getExpectedRoundCardCount(payload);
  const cards = payload.mode === "room"
    ? payload.answerCards.map((card) => card.answer)
    : payload.mode === "local"
    ? [payload.answer, payload.opponentAnswer]
    : [payload.answer, ...normalizeBotCards(payload.botCards, expectedCards - 1)];
  const answerBank = [payload.canonicalAnswer, ...payload.acceptedAnswers].filter(Boolean);
  const correctIndexes = cards
    .map((card, index) => ({ index, score: scoreAnswerAgainstBank(card, answerBank) }))
    .filter((entry) => isAnswerCorrectByStrictness(cards[entry.index], answerBank, payload.gradingStrictness))
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.index)
    .filter((index) => index >= 0 && index < expectedCards);
  const winnerIndex = correctIndexes[0] ?? 0;

  return {
    cards: cards.slice(0, expectedCards),
    winnerIndex,
    correctIndexes: [...new Set(correctIndexes)],
    aiReviewedIndexes: [],
    aiSecondOpinionIndexes: [],
    source: "local-fallback"
  };
}

function getRoundAnswerEntries(payload, cards = []) {
  if (payload.mode === "room") {
    return payload.answerCards.map((card, index) => ({
      index,
      label: card.label || `Player ${index + 1}`,
      answer: cards[index] || card.answer || ""
    }));
  }
  if (payload.mode === "local") {
    return [
      { index: 0, label: "Player 1", answer: cards[0] || payload.answer || "" },
      { index: 1, label: "Player 2", answer: cards[1] || payload.opponentAnswer || "" }
    ];
  }
  const botLabels = Array.isArray(payload.botLabels) ? payload.botLabels : [];
  return cards.map((answer, index) => ({
    index,
    label: index === 0 ? "Player" : botLabels[index - 1] || `Bot ${index}`,
    answer
  }));
}

function getAiSecondOpinionCandidates(payload, localResult) {
  const answerBank = [payload.canonicalAnswer, ...payload.acceptedAnswers].filter(Boolean);
  if (!answerBank.length || !Array.isArray(localResult.cards)) {
    return [];
  }
  const alreadyCorrect = new Set(localResult.correctIndexes || []);
  return getRoundAnswerEntries(payload, localResult.cards)
    .map((entry) => ({
      ...entry,
      score: scoreAnswerAgainstBank(entry.answer, answerBank)
    }))
    .filter((entry) => !alreadyCorrect.has(entry.index) && shouldAskAiForSecondOpinion(entry.answer, answerBank, entry.score, payload.gradingStrictness))
    .slice(0, 4);
}

function shouldAskAiForSecondOpinion(answer, acceptedAnswers, localScore, strictness = "normal") {
  const normalizedStrictness = normalizeGradingStrictness(strictness);
  if (normalizedStrictness === "exact") {
    return false;
  }
  const normalized = normalizeTriviaAnswer(answer);
  if (!hasUsefulAnswerSignal(normalized)) {
    return false;
  }
  const localThreshold = getLocalGradingThreshold(normalizedStrictness);
  if (localScore >= localThreshold) {
    return false;
  }
  const scoreGate = normalizedStrictness === "forgiving" ? 0.34 : normalizedStrictness === "strict" ? 0.62 : 0.42;
  if (localScore >= scoreGate) {
    return true;
  }
  const answerWords = normalized.split(" ").filter(Boolean);
  const normalizedAccepted = acceptedAnswers
    .map(normalizeTriviaAnswer)
    .filter(Boolean);
  const acceptedWords = normalizedAccepted
    .flatMap((entry) => entry.split(" ").filter((word) => word.length >= 4));
  if (!answerWords.length || !acceptedWords.length) {
    return false;
  }
  const compactAnswer = normalized.replace(/\s+/g, "");
  const bestCompactScore = Math.max(0, ...normalizedAccepted.map((entry) => (
    scoreTriviaToken(compactAnswer, entry.replace(/\s+/g, ""))
  )));
  const compactGate = normalizedStrictness === "forgiving" ? 0.55 : normalizedStrictness === "strict" ? 0.78 : 0.62;
  if (bestCompactScore >= compactGate) {
    return true;
  }
  const bestTokenScore = Math.max(0, ...answerWords.flatMap((answerWord) => (
    acceptedWords.map((acceptedWord) => scoreTriviaToken(answerWord, acceptedWord))
  )));
  const hasSharedDistinctiveWord = answerWords.some((word) => word.length >= 4 && acceptedWords.includes(word));
  const tokenGate = normalizedStrictness === "forgiving" ? 0.48 : normalizedStrictness === "strict" ? 0.72 : 0.55;
  return hasSharedDistinctiveWord || bestTokenScore >= tokenGate;
}

function hasUsefulAnswerSignal(normalizedAnswer) {
  if (!normalizedAnswer || normalizedAnswer.length < 3 || normalizedAnswer.length > 80) {
    return false;
  }
  const compact = normalizedAnswer.replace(/\s+/g, "");
  if (compact.length < 3 || /(.)\1{3,}/.test(compact)) {
    return false;
  }
  const fillerAnswers = new Set([
    "idk",
    "i dont know",
    "dont know",
    "no idea",
    "unknown",
    "none",
    "nothing",
    "n a",
    "na",
    "test",
    "asdf",
    "blah",
    "random",
    "guess"
  ]);
  if (fillerAnswers.has(normalizedAnswer)) {
    return false;
  }
  const letters = compact.replace(/[^a-z]/g, "");
  if (letters.length >= 4 && !/[aeiouy]/.test(letters)) {
    return false;
  }
  return /[a-z0-9]/.test(compact);
}

function scoreAnswerAgainstBank(answer, acceptedAnswers) {
  const normalizedAnswer = normalizeTriviaAnswer(answer);
  if (!normalizedAnswer) {
    return 0;
  }

  const normalizedAccepted = acceptedAnswers.map(normalizeTriviaAnswer).filter(Boolean);
  let bestScore = 0;
  for (const accepted of normalizedAccepted) {
    if (normalizedAnswer === accepted) {
      bestScore = Math.max(bestScore, 1);
      continue;
    }

    if (normalizedAnswer === createAcronym(accepted) || createAcronym(normalizedAnswer) === accepted) {
      bestScore = Math.max(bestScore, 0.95);
      continue;
    }

    const tokenAwareScore = scoreTokenAwareAnswer(normalizedAnswer, accepted);
    if (tokenAwareScore > 0) {
      bestScore = Math.max(bestScore, tokenAwareScore);
    }

    const partialAnswerScore = scoreDistinctivePartialAnswer(normalizedAnswer, accepted);
    if (partialAnswerScore > 0) {
      bestScore = Math.max(bestScore, partialAnswerScore);
    }

    const answerWords = new Set(normalizedAnswer.split(" ").filter(Boolean));
    const acceptedWords = accepted.split(" ").filter(Boolean);
    const sharedWords = acceptedWords.filter((word) => answerWords.has(word));
    if (acceptedWords.length > 1 && sharedWords.length === acceptedWords.length) {
      bestScore = Math.max(bestScore, 0.9);
    }

    const distance = levenshteinDistance(normalizedAnswer, accepted);
    const longest = Math.max(normalizedAnswer.length, accepted.length, 1);
    const similarity = 1 - (distance / longest);
    const typoFloor = longest <= 5 ? 0.82 : 0.78;
    if (similarity >= typoFloor) {
      bestScore = Math.max(bestScore, similarity);
    }
  }

  return bestScore;
}

function scoreTokenAwareAnswer(normalizedAnswer, normalizedAccepted) {
  const answerWords = normalizedAnswer.split(" ").filter(Boolean);
  const acceptedWords = normalizedAccepted.split(" ").filter(Boolean);
  if (!answerWords.length || !acceptedWords.length) {
    return 0;
  }

  if (acceptedWords.length === 1 && answerWords.length === 1) {
    return scoreTriviaToken(answerWords[0], acceptedWords[0]);
  }

  const acceptedNumbers = acceptedWords.filter((word) => /^\d+$/.test(word));
  const answerNumbers = new Set(answerWords.filter((word) => /^\d+$/.test(word)));
  const numericAnchored = acceptedNumbers.length > 0 && acceptedNumbers.every((word) => answerNumbers.has(word));
  const tokenMatchThreshold = numericAnchored ? 0.58 : 0.72;
  const usedAnswerIndexes = new Set();
  let scoreTotal = 0;
  let matchedCount = 0;
  for (const acceptedWord of acceptedWords) {
    let best = { index: -1, score: 0 };
    answerWords.forEach((answerWord, index) => {
      if (usedAnswerIndexes.has(index)) {
        return;
      }
      const score = scoreTriviaToken(answerWord, acceptedWord);
      if (score > best.score) {
        best = { index, score };
      }
    });
    if (best.score >= tokenMatchThreshold) {
      usedAnswerIndexes.add(best.index);
      scoreTotal += best.score;
      matchedCount += 1;
    }
  }

  const coverage = matchedCount / acceptedWords.length;
  if (coverage < 0.68) {
    return 0;
  }
  if (acceptedNumbers.length && !numericAnchored) {
    return 0;
  }
  const score = Math.min(0.96, (scoreTotal / Math.max(1, acceptedWords.length)) * coverage);
  return numericAnchored && coverage >= 1 ? Math.max(0.86, score) : score;
}

function scoreTriviaToken(answerWord, acceptedWord) {
  if (!answerWord || !acceptedWord) {
    return 0;
  }
  if (answerWord === acceptedWord) {
    return 1;
  }
  if (/^\d+$/.test(answerWord) || /^\d+$/.test(acceptedWord)) {
    return answerWord === acceptedWord ? 1 : 0;
  }
  if (answerWord.length >= 4 && acceptedWord.length >= 4 && (answerWord.includes(acceptedWord) || acceptedWord.includes(answerWord))) {
    return 0.88;
  }

  let bestScore = 0;
  const distance = levenshteinDistance(answerWord, acceptedWord);
  const longest = Math.max(answerWord.length, acceptedWord.length, 1);
  const similarity = 1 - (distance / longest);
  const shortest = Math.min(answerWord.length, acceptedWord.length);
  const messyTypoScore = scoreMessyTriviaTypo(answerWord, acceptedWord);
  if (messyTypoScore > 0) {
    bestScore = Math.max(bestScore, messyTypoScore);
  }
  const loosePhoneticScore = scoreLoosePhoneticMatch(answerWord, acceptedWord);
  if (loosePhoneticScore > 0) {
    bestScore = Math.max(bestScore, loosePhoneticScore);
  }
  if (shortest <= 4 && distance <= 1) {
    bestScore = Math.max(bestScore, 0.78, similarity);
  }
  if (shortest <= 6 && distance <= 2 && similarity >= 0.58) {
    bestScore = Math.max(bestScore, 0.58, similarity);
  }
  if (similarity >= 0.78) {
    bestScore = Math.max(bestScore, similarity);
  }

  const answerPhonetic = createLoosePhoneticKey(answerWord);
  const acceptedPhonetic = createLoosePhoneticKey(acceptedWord);
  if (answerPhonetic && acceptedPhonetic && answerPhonetic === acceptedPhonetic && Math.max(answerPhonetic.length, acceptedPhonetic.length) >= 2) {
    bestScore = Math.max(bestScore, 0.9);
  }

  return bestScore;
}

function scoreLoosePhoneticMatch(answerWord, acceptedWord) {
  const shortest = Math.min(answerWord.length, acceptedWord.length);
  if (shortest < 7) {
    return 0;
  }
  const answerPhonetic = createLoosePhoneticKey(answerWord);
  const acceptedPhonetic = createLoosePhoneticKey(acceptedWord);
  if (!answerPhonetic || !acceptedPhonetic || answerPhonetic[0] !== acceptedPhonetic[0]) {
    return 0;
  }
  if (answerPhonetic === acceptedPhonetic && Math.max(answerPhonetic.length, acceptedPhonetic.length) >= 2) {
    return 0.9;
  }

  const phoneticDistance = levenshteinDistance(answerPhonetic, acceptedPhonetic);
  const phoneticLongest = Math.max(answerPhonetic.length, acceptedPhonetic.length, 1);
  const phoneticSimilarity = 1 - (phoneticDistance / phoneticLongest);
  const wordDistance = levenshteinDistance(answerWord, acceptedWord);
  const wordLongest = Math.max(answerWord.length, acceptedWord.length, 1);
  const wordSimilarity = 1 - (wordDistance / wordLongest);
  const overlap = getCharacterOverlapRatio(answerWord, acceptedWord);
  if (
    Math.min(answerPhonetic.length, acceptedPhonetic.length) >= 4
    && phoneticDistance <= 2
    && phoneticSimilarity >= 0.58
    && wordSimilarity >= 0.5
    && overlap >= 0.64
  ) {
    return 0.84;
  }
  return 0;
}

function scoreMessyTriviaTypo(answerWord, acceptedWord) {
  const shortest = Math.min(answerWord.length, acceptedWord.length);
  const longest = Math.max(answerWord.length, acceptedWord.length);
  if (shortest < 7 || longest - shortest > 2) {
    return 0;
  }
  if (answerWord[0] !== acceptedWord[0] || answerWord[answerWord.length - 1] !== acceptedWord[acceptedWord.length - 1]) {
    return 0;
  }
  const overlap = getCharacterOverlapRatio(answerWord, acceptedWord);
  if (overlap >= 0.88) {
    return 0.88;
  }
  if (overlap >= 0.8 && levenshteinDistance(createLoosePhoneticKey(answerWord), createLoosePhoneticKey(acceptedWord)) <= 1) {
    return 0.84;
  }
  return 0;
}

function getCharacterOverlapRatio(left, right) {
  const counts = new Map();
  String(left || "").split("").forEach((char) => {
    counts.set(char, (counts.get(char) || 0) + 1);
  });
  let shared = 0;
  String(right || "").split("").forEach((char) => {
    const count = counts.get(char) || 0;
    if (count > 0) {
      shared += 1;
      counts.set(char, count - 1);
    }
  });
  return shared / Math.max(String(right || "").length, 1);
}

function scoreDistinctivePartialAnswer(normalizedAnswer, normalizedAccepted) {
  const answerWords = normalizedAnswer.split(" ").filter(Boolean);
  const acceptedWords = normalizedAccepted.split(" ").filter(Boolean);
  if (answerWords.length !== 1 || acceptedWords.length < 2) {
    return 0;
  }

  const answerWord = answerWords[0];
  if (answerWord.length < 4) {
    return 0;
  }

  let bestTokenScore = 0;
  acceptedWords
    .filter((word) => word.length >= 4)
    .forEach((word) => {
      if (answerWord === word) {
        bestTokenScore = Math.max(bestTokenScore, 0.94);
        return;
      }
      const distance = levenshteinDistance(answerWord, word);
      const longest = Math.max(answerWord.length, word.length, 1);
      const similarity = 1 - (distance / longest);
      if (similarity >= 0.82) {
        bestTokenScore = Math.max(bestTokenScore, Math.min(0.93, similarity));
      }
    });
  return bestTokenScore;
}

function normalizeTriviaAnswer(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\b(\d+)(st|nd|rd|th)\b/g, "$1")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(the|a|an)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map(normalizeTriviaAnswerToken)
    .join(" ");
}

function createAcronym(value) {
  return String(value || "")
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word[0])
    .join("");
}

function normalizeTriviaAnswerToken(token) {
  const value = String(token || "").trim();
  if (!value) {
    return "";
  }
  const romanNumber = romanNumeralToNumber(value);
  return romanNumber ? String(romanNumber) : value;
}

function romanNumeralToNumber(value) {
  const token = String(value || "").toUpperCase();
  if (!/^[IVXLCDM]+$/.test(token)) {
    return 0;
  }
  const values = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
  let total = 0;
  for (let index = 0; index < token.length; index += 1) {
    const current = values[token[index]] || 0;
    const next = values[token[index + 1]] || 0;
    total += current < next ? -current : current;
  }
  if (total <= 0 || total > 3999 || numberToRomanNumeral(total) !== token) {
    return 0;
  }
  return total;
}

function numberToRomanNumeral(number) {
  const entries = [
    [1000, "M"], [900, "CM"], [500, "D"], [400, "CD"],
    [100, "C"], [90, "XC"], [50, "L"], [40, "XL"],
    [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]
  ];
  let remaining = Number(number) || 0;
  let result = "";
  for (const [value, numeral] of entries) {
    while (remaining >= value) {
      result += numeral;
      remaining -= value;
    }
  }
  return result;
}

function createLoosePhoneticKey(value) {
  const cleaned = String(value || "")
    .toLowerCase()
    .replace(/ph/g, "f")
    .replace(/ght/g, "t")
    .replace(/[cq]/g, "k")
    .replace(/x/g, "ks")
    .replace(/z/g, "s")
    .replace(/(.)\1+/g, "$1")
    .replace(/[sxz]+$/g, "");
  if (!cleaned) {
    return "";
  }
  const first = cleaned[0];
  const rest = cleaned.slice(1).replace(/[aeiouy]/g, "");
  return `${first}${rest}`;
}

function levenshteinDistance(a, b) {
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  const current = new Array(b.length + 1);

  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + cost
      );
    }
    for (let j = 0; j <= b.length; j += 1) {
      previous[j] = current[j];
    }
  }

  return previous[b.length] || 0;
}

function extractOutputText(data) {
  if (typeof data.output_text === "string") {
    return data.output_text;
  }

  for (const item of data.output || []) {
    for (const content of item.content || []) {
      if (content.type === "output_text" && typeof content.text === "string") {
        return content.text;
      }
    }
  }

  throw new Error("OpenAI response did not include output text.");
}

function validateRoundResult(result, payload) {
  const expectedCards = getExpectedRoundCardCount(payload);
  if (payload.mode !== "local" && (!Array.isArray(result.cards) || result.cards.length !== expectedCards)) {
    throw new Error(`AI result did not include exactly ${expectedCards} cards.`);
  }

  const cards =
    payload.mode === "room"
      ? payload.answerCards.map((card) => card.answer)
      : payload.mode === "local"
      ? [payload.answer, payload.opponentAnswer]
      : payload.botCards.length
        ? [payload.answer, ...payload.botCards]
      : result.cards.map((card) => String(card).trim().slice(0, 140));
  if (payload.mode !== "room") {
    cards[0] = payload.answer;
  }
  if (payload.mode === "local") {
    cards[1] = payload.opponentAnswer;
  }
  const winnerIndex = Number(result.winnerIndex);
  const modelCorrectIndexes = Array.isArray(result.correctIndexes)
    ? [...new Set(result.correctIndexes.map(Number).filter((index) => Number.isInteger(index) && index >= 0 && index < expectedCards && String(cards[index] || "").trim()))]
    : [];
  const answerBank = [payload.canonicalAnswer, ...payload.acceptedAnswers].filter(Boolean);
  const localCorrectIndexes = cards
    .map((card, index) => ({ index, score: scoreAnswerAgainstBank(card, answerBank) }))
    .filter((entry) => isAnswerCorrectByStrictness(cards[entry.index], answerBank, payload.gradingStrictness))
    .map((entry) => entry.index);
  const safeModelCorrectIndexes = normalizeGradingStrictness(payload.gradingStrictness) === "exact"
    ? modelCorrectIndexes.filter((index) => localCorrectIndexes.includes(index))
    : modelCorrectIndexes;
  const correctIndexes = [...new Set([...safeModelCorrectIndexes, ...localCorrectIndexes])];
  const fallbackWinnerIndex = correctIndexes[0] ?? 0;
  const safeWinnerIndex = correctIndexes.length
    ? (correctIndexes.includes(winnerIndex) ? winnerIndex : fallbackWinnerIndex)
    : (Number.isInteger(winnerIndex) && winnerIndex >= 0 && winnerIndex < expectedCards ? winnerIndex : fallbackWinnerIndex);

  return {
    cards,
    winnerIndex: safeWinnerIndex,
    correctIndexes,
    source: "model"
  };
}

function getGenericJudge() {
  return {
    name: "Trivia Grader",
    avatar: "AI",
    title: "Answer checker",
    bio: "Checks trivia answers with room for aliases, abbreviations, and minor spelling mistakes.",
    likes: ["accuracy", "aliases", "specific answers"],
    dislikes: ["wild guesses", "wrong category", "blank answers"],
    voice: "concise quiz grading",
    tone: "fair",
    source: "local"
  };
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 3000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        "User-Agent": "CardsAgainstAI/0.1 local trivia game",
        ...(options.headers || {})
      }
    });
  } finally {
    clearTimeout(timeout);
  }
}

function isAllowedImageProxyUrl(value) {
  try {
    const parsed = new URL(String(value || ""));
    if (parsed.protocol !== "https:") {
      return false;
    }
    const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost")) {
      return false;
    }
    return !isBlockedNetworkAddress(hostname);
  } catch {
    return false;
  }
}

async function isAllowedResolvedImageProxyUrl(value) {
  try {
    const parsed = new URL(String(value || ""));
    const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (!hostname || isIP(hostname)) {
      return isAllowedImageProxyUrl(value);
    }
    const addresses = await lookup(hostname, { all: true, verbatim: true });
    return Array.isArray(addresses)
      && addresses.length > 0
      && addresses.every((entry) => !isBlockedNetworkAddress(entry.address));
  } catch {
    return false;
  }
}

function isBlockedNetworkAddress(address) {
  const hostname = String(address || "").toLowerCase().replace(/^\[|\]$/g, "");
  const ipVersion = isIP(hostname);
  if (ipVersion === 4) {
    const [a, b] = hostname.split(".").map((part) => Number(part));
    return a === 10
      || a === 127
      || a === 0
      || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168)
      || (a === 192 && b === 0)
      || (a === 198 && (b === 18 || b === 19));
  }
  if (ipVersion === 6) {
    return hostname === "::1"
      || hostname === "::"
      || hostname.startsWith("fc")
      || hostname.startsWith("fd")
      || hostname.startsWith("fe80:");
  }
  return false;
}

async function fetchImageAsset(source, timeoutMs = 5000) {
  const cached = imageCache.get(source);
  if (cached && cached.expiresAt > Date.now()) {
    return cached;
  }
  if (cached) {
    deleteImageCacheEntry(source);
  }

  const response = await fetchWithTimeout(source, {
    headers: {
      Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36"
    }
  }, timeoutMs);
  if (!isAllowedImageProxyUrl(response.url || source)) {
    throw new Error("Image fetch redirected to a blocked host");
  }
  if (!(await isAllowedResolvedImageProxyUrl(response.url || source))) {
    throw new Error("Image fetch redirected to a blocked address");
  }
  const contentType = String(response.headers.get("content-type") || "");
  if (!response.ok || !contentType.startsWith("image/")) {
    throw new Error("Image fetch failed");
  }

  const arrayBuffer = await response.arrayBuffer();
  if (arrayBuffer.byteLength > 8 * 1024 * 1024) {
    throw new Error("Image too large");
  }

  const image = {
    buffer: Buffer.from(arrayBuffer),
    contentType,
    byteLength: arrayBuffer.byteLength,
    expiresAt: Date.now() + imageCacheTtlMs
  };
  setImageCacheEntry(source, image);
  return image;
}

function setImageCacheEntry(source, image) {
  deleteImageCacheEntry(source);
  imageCache.set(source, image);
  imageCacheBytes += Number(image.byteLength || image.buffer?.byteLength || 0);
  pruneImageCache();
}

function deleteImageCacheEntry(source) {
  const existing = imageCache.get(source);
  if (existing) {
    imageCacheBytes = Math.max(0, imageCacheBytes - Number(existing.byteLength || existing.buffer?.byteLength || 0));
    imageCache.delete(source);
  }
}

function pruneImageCache(now = Date.now()) {
  for (const [source, image] of imageCache.entries()) {
    if (image.expiresAt <= now) {
      deleteImageCacheEntry(source);
    }
  }
  while (imageCache.size > imageCacheMaxEntries || imageCacheBytes > imageCacheMaxBytes) {
    const firstKey = imageCache.keys().next().value;
    if (!firstKey) {
      break;
    }
    deleteImageCacheEntry(firstKey);
  }
}

function isUsableImageUrl(url) {
  return /^https:\/\/\S+$/i.test(String(url || ""));
}

function withProxiedImageUrl(image) {
  if (!image?.url || image.url.startsWith("data:") || image.url.startsWith("/api/image")) {
    return image;
  }
  return {
    ...image,
    url: `/api/image?src=${encodeURIComponent(image.url)}`
  };
}

function createEmptyQuestionImage(reason = "Image not retrieved") {
  return {
    url: "",
    alt: "",
    credit: "",
    missingReason: reason
  };
}

function normalizeQuestionImage(image) {
  const source = image && typeof image === "object" ? image : {};
  const url = String(source.url || "").trim().slice(0, 4000);
  if (!isUsableImageUrl(url) && !/^data:image\/svg\+xml/i.test(url)) {
    return { url: "", alt: "", credit: "" };
  }
  return {
    url,
    alt: String(source.alt || "Trivia reference image").trim().slice(0, 160),
    credit: String(source.credit || "").trim().slice(0, 160)
  };
}

function normalizeBotCards(cards, count = 2) {
  const targetCount = Math.max(1, Math.min(9, Number(count) || 2));
  const normalized = Array.isArray(cards) ? cards.map((card) => String(card).trim().slice(0, 140)).filter(Boolean).slice(0, targetCount) : [];
  const fallbacks = [
    "I don't know",
    "Maybe Paris",
    "Not sure",
    "Could be London",
    "No idea",
    "Possibly Einstein",
    "The Moon",
    "New York",
    "Shakespeare"
  ];

  while (normalized.length < targetCount) {
    normalized.push(fallbacks[normalized.length] || `Bot guess ${normalized.length + 1}`);
  }

  return normalized;
}

function requireAdmin(req, res) {
  if (getAdminSession(req)) {
    return true;
  }

  const configuredToken = getAdminToken();
  if (!configuredToken) {
    sendJson(res, 503, { error: "ADMIN_TOKEN is not configured." });
    return false;
  }

  const authorization = String(req.headers.authorization || "");
  const bearerToken = authorization.replace(/^Bearer\s+/i, "").trim();
  const headerToken = String(req.headers["x-admin-token"] || "").trim();
  if (secureEqual(bearerToken, configuredToken) || secureEqual(headerToken, configuredToken)) {
    return true;
  }

  sendJson(res, 401, { error: "Unauthorized." });
  return false;
}

function getAdminToken() {
  return String(process.env.ADMIN_TOKEN || "").trim();
}

function getSupabaseUrl() {
  return String(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
}

function getSupabaseAnonKey() {
  return String(process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "").trim();
}

function getSupabaseJwtSecret() {
  return String(process.env.SUPABASE_JWT_SECRET || "").trim();
}

function createAdminSessionCookie(expiresAt) {
  const payload = Buffer.from(JSON.stringify({
    role: "admin",
    exp: expiresAt
  })).toString("base64url");
  const signature = signAdminPayload(payload);
  return `${payload}.${signature}`;
}

function getAdminSession(req) {
  const token = getCookie(req, adminCookieName);
  if (!token) {
    return null;
  }

  const [payload, signature] = token.split(".");
  if (!payload || !signature || !secureEqual(signature, signAdminPayload(payload))) {
    return null;
  }

  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (session.role !== "admin" || Number(session.exp) <= Date.now()) {
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

function signAdminPayload(payload) {
  return createHmac("sha256", getAdminToken() || "missing-admin-token")
    .update(payload)
    .digest("base64url");
}

function secureEqual(left, right) {
  const leftValue = String(left || "");
  const rightValue = String(right || "");
  if (!leftValue || !rightValue) {
    return false;
  }

  const leftBuffer = Buffer.from(leftValue);
  const rightBuffer = Buffer.from(rightValue);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function getCookie(req, name) {
  const cookies = String(req.headers.cookie || "").split(";").map((entry) => entry.trim());
  const prefix = `${name}=`;
  const cookie = cookies.find((entry) => entry.startsWith(prefix));
  return cookie ? decodeURIComponent(cookie.slice(prefix.length)) : "";
}

function serializeCookie(name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  if (options.maxAge !== undefined) {
    parts.push(`Max-Age=${Math.max(0, Math.floor(Number(options.maxAge) || 0))}`);
  }
  if (options.path) {
    parts.push(`Path=${options.path}`);
  }
  if (options.httpOnly) {
    parts.push("HttpOnly");
  }
  if (options.secure) {
    parts.push("Secure");
  }
  if (options.sameSite) {
    parts.push(`SameSite=${options.sameSite}`);
  }
  return parts.join("; ");
}

function isSecureRequest(req) {
  return String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim() === "https";
}

function getSecurityHeaders() {
  return {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "SAMEORIGIN",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
    "Content-Security-Policy": [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' https: data: blob:",
      "font-src 'self' data:",
      "media-src 'self' https: data: blob:",
      "connect-src 'self' https: wss:",
      "object-src 'none'",
      "base-uri 'self'",
      "frame-ancestors 'self'",
      "form-action 'self'"
    ].join("; ")
  };
}

function sendJson(res, status, payload, headers = {}) {
  res.writeHead(status, {
    ...getSecurityHeaders(),
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...headers
  });
  res.end(JSON.stringify(payload));
}

function sendText(res, status, message) {
  res.writeHead(status, {
    ...getSecurityHeaders(),
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(message);
}
