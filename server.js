const { createServer } = require("node:http");
const { readFile, stat, writeFile } = require("node:fs/promises");
const { createReadStream, existsSync, readFileSync } = require("node:fs");
const { extname, join, normalize } = require("node:path");
const { createHmac, randomBytes, timingSafeEqual } = require("node:crypto");
const { lookup } = require("node:dns/promises");
const { isIP } = require("node:net");
const { createGzip } = require("node:zlib");
const { createBackendStore } = require("./lib/backend-store");
const packageInfo = require("./package.json");

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
const roomCommandQueues = new Map();
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
const chaosInfusedPowerSuffix = "__chaos";
// Keep this list deliberately small while the server power engine is being
// migrated. Unlisted powers continue through the compatibility path below.
const serverPowerEngineMigratedIds = new Set([
  "time_bender",
  "lightning_strike",
  "zap_strike",
  "shameless",
  "sin_pride",
  "hard_reset"
]);
const hostReconnectGraceMs = 60 * 1000;
const participantReconnectGraceMs = 60 * 1000;
const participantActiveStaleMs = 3 * 60 * 1000;
const emptyRoomCloseGraceMs = 3 * 60 * 1000;
const rateLimitBuckets = new Map();
const chatCooldownBuckets = new Map();
const aiRoundCache = new Map();
const aiRoundCacheTtlMs = 2 * 60 * 1000;
const aiRoundCacheMaxEntries = 250;
const profileShopRotationIntervalMs = 3 * 60 * 60 * 1000;
const profileShopRotationSize = 3;
const profileShopRotationPurchaseGraceMs = 12 * 60 * 60 * 1000;
const inventoryShopCatalog = new Map([
  ["style:doom", { cost: 1000 }],
  ["style:chromatic", { cost: 1000 }],
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
const roundGradingModeOptions = ["mixed", "local", "force-ai"];
const roundGradingModeSet = new Set(roundGradingModeOptions);
const lowSignalFillerAnswers = new Set([
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
const commonTriviaAbbreviationAliases = new Map([
  ["youtube", ["yt", "u tube"]],
  ["instagram", ["ig", "insta"]],
  ["facebook", ["fb"]],
  ["tiktok", ["tt", "tik tok"]],
  ["twitter", ["x", "twttr"]],
  ["reddit", ["rdt"]],
  ["discord", ["dc"]],
  ["snapchat", ["sc"]],
  ["wikipedia", ["wiki"]],
  ["javascript", ["js"]],
  ["typescript", ["ts"]],
  ["artificial intelligence", ["ai"]],
  ["virtual reality", ["vr"]],
  ["augmented reality", ["ar"]],
  ["united states", ["us", "usa", "u s", "u s a"]],
  ["united states of america", ["us", "usa", "u s", "u s a"]],
  ["united kingdom", ["uk", "u k"]],
  ["european union", ["eu", "e u"]],
  ["united nations", ["un", "u n"]],
  ["world war", ["ww"]],
  ["world wide web", ["www"]],
  ["national basketball association", ["nba"]],
  ["national football league", ["nfl"]],
  ["major league baseball", ["mlb"]],
  ["national hockey league", ["nhl"]]
]);
const questionBank = loadQuestionBank();
const runtimeQuestionBankCacheTtlMs = 30 * 1000;
let runtimeQuestionBankCache = null;
let runtimeQuestionBankPromise = null;

function invalidateRuntimeQuestionBankCache() {
  runtimeQuestionBankCache = null;
}

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

    if (req.method === "GET" && url.pathname === "/api/version") {
      handleAppVersion(res);
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

    if (req.method === "POST" && url.pathname === "/api/debug/ai-shield") {
      if (!requireAdmin(req, res)) {
        return;
      }
      await handleDebugAiShield(req, res);
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

    const roomGetMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)$/);
    if (roomGetMatch && req.method === "GET") {
      await handleGetRoom(req, res, roomGetMatch[1]);
      return;
    }

    const roomCommandMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)\/commands$/);
    if (roomCommandMatch && req.method === "POST") {
      await handleRoomCommand(req, res, roomCommandMatch[1]);
      return;
    }

    const roomEventsMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)\/events$/);
    if (roomEventsMatch && req.method === "GET") {
      await handleRoomEvents(req, url, res, roomEventsMatch[1]);
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
    const close = await backendStore.getRoomClose(normalizedCode);
    sendJson(res, 410, { closed: true, close: close || createRoomClosePayload(normalizedCode, "host-disconnected") });
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

  const previousRevision = getRoomRevision(room);
  room.status = "complete";
  room.closed = createRoomClosePayload(code, "admin");
  finalizeRoom(room);
  stampRoomEvent(room, "room_closed", { reason: "admin" });
  const storedRoom = await backendStore.upsertRoom(room);
  await backendStore.upsertRoomClose(room.closed);
  const response = await createRoomCommandResponse(storedRoom, previousRevision, {
    includePrivateSecrets: true
  });
  sendJson(res, 200, {
    ...response,
    room: sanitizeRoomForClient(storedRoom, { includePrivateSecrets: true })
  });
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
  const authContext = await getQuestionSubmissionAuthContext(req, creatorId);
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
    const authContext = await getQuestionSubmissionAuthContext(req, requestedCreatorId);
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

function handleAppVersion(res) {
  const commit = String(process.env.VERCEL_GIT_COMMIT_SHA || process.env.GIT_COMMIT_SHA || "").trim();
  sendJson(res, 200, {
    version: String(packageInfo.version || "0.1.0"),
    commit: commit ? commit.slice(0, 40) : "",
    branch: String(process.env.VERCEL_GIT_COMMIT_REF || "").trim(),
    deployedAt: String(process.env.VERCEL_DEPLOYMENT_ID || "").trim()
  });
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
  const authContext = await getInventoryAuthContext(req, requestedUserId);
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
    const authContext = await getInventoryAuthContext(req, requestedUserId);
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
    const authContext = await getInventoryAuthContext(req, normalizeInventoryUserId(body.userId));
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
    const authContext = await getInventoryAuthContext(req, normalizeInventoryUserId(body.userId));
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

async function getInventoryAuthContext(req, requestedUserId) {
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
  const auth = await getAuthenticatedUser(req);
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

async function getQuestionSubmissionAuthContext(req, requestedCreatorId) {
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
  const auth = await getAuthenticatedUser(req);
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

async function getAuthenticatedUser(req) {
  const token = getBearerToken(req);
  if (!token) {
    return { ok: false, error: "" };
  }

  const secret = getSupabaseJwtSecret();
  let localVerificationFailure = secret
    ? { ok: false, status: 401, error: "Invalid authentication token." }
    : { ok: false, status: 503, error: "SUPABASE_JWT_SECRET is not configured." };

  if (secret) {
    try {
      const payload = verifySupabaseJwt(token, secret);
      const userId = normalizeInventoryUserId(payload.sub);
      if (!userId) {
        localVerificationFailure = { ok: false, status: 401, error: "Invalid authentication token." };
      } else {
        return {
          ok: true,
          userId,
          payload
        };
      }
    } catch {
      localVerificationFailure = { ok: false, status: 401, error: "Invalid authentication token." };
    }
  }

  const remoteVerification = await verifySupabaseAccessToken(token);
  return remoteVerification || localVerificationFailure;
}

async function verifySupabaseAccessToken(token) {
  const supabaseUrl = getSupabaseUrl().replace(/\/+$/g, "");
  const anonKey = getSupabaseAnonKey();
  if (!supabaseUrl || !anonKey || typeof fetch !== "function") {
    return null;
  }

  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timeoutId = controller
    ? setTimeout(() => controller.abort(), 2500)
    : null;
  try {
    const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
      method: "GET",
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${token}`
      },
      signal: controller?.signal
    });
    if (response.status === 401 || response.status === 403) {
      return { ok: false, status: 401, error: "Invalid authentication token." };
    }
    if (!response.ok) {
      return null;
    }
    const user = await response.json().catch(() => null);
    const userId = normalizeInventoryUserId(user?.id);
    return userId
      ? { ok: true, userId, payload: user }
      : { ok: false, status: 401, error: "Invalid authentication token." };
  } catch {
    return null;
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
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
    hard: 0,
    brutal: 0
  }]));

  runtimeQuestionBank.forEach((question) => {
    const bucket = counts[question.theme] || (counts[question.theme] = {
      total: 0,
      image: 0,
      text: 0,
      multipleChoice: 0,
      easy: 0,
      medium: 0,
      hard: 0,
      brutal: 0
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
      language: normalizeQuestionLanguage(question.language),
      gradingStrictness: normalizeGradingStrictness(question.gradingStrictness),
      theme: question.theme,
      difficulty: question.difficulty,
      debugBatch: question.debugBatch,
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
  invalidateRuntimeQuestionBankCache();
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
  invalidateRuntimeQuestionBankCache();
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
  invalidateRuntimeQuestionBankCache();
}

async function markQuestionOverrideDeleted(id) {
  await backendStore.upsertQuestionOverride({
    id,
    question: null,
    deleted: true,
    source: "debug"
  });
  invalidateRuntimeQuestionBankCache();
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

  const difficulty = ["easy", "medium", "hard", "brutal"].includes(source.difficulty) ? source.difficulty : "";
  if (!difficulty) {
    throw new Error("Choose easy, medium, hard, or brutal difficulty.");
  }

  const type = source.type === "image" ? "image" : "text";
  const questionStyle = source.questionStyle === "multiple-choice" || source.style === "multiple-choice" || source.type === "multiple-choice"
    ? "multiple-choice"
    : "standard";
  const language = normalizeQuestionLanguage(source.language || source.questionLanguage);
  const debugBatch = normalizeQuestionDebugBatch(source.debugBatch);
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
    language,
    gradingStrictness,
    theme,
    difficulty,
    ...(debugBatch ? { debugBatch } : {}),
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

function normalizeRoundGradingMode(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "local-only" || normalized === "non-ai" || normalized === "no-ai") {
    return "local";
  }
  if (normalized === "ai" || normalized === "ai-only" || normalized === "force_ai") {
    return "force-ai";
  }
  return roundGradingModeSet.has(normalized) ? normalized : "mixed";
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

function getRoomRevision(room) {
  return clampServerNumber(room?.revision, 0, Number.MAX_SAFE_INTEGER, 0);
}

function normalizeRoomEvents(events) {
  return (Array.isArray(events) ? events : [])
    .map((event) => ({
      id: String(event.id || "").slice(0, 120),
      roomCode: String(event.roomCode || event.payload?.roomCode || event.payload?.code || "").trim().toUpperCase().slice(0, 16),
      revision: clampServerNumber(event.revision, 0, Number.MAX_SAFE_INTEGER, 0),
      type: String(event.type || "room_updated").slice(0, 60),
      actorId: String(event.actorId || event.payload?.actorId || event.payload?.participantId || event.payload?.hostParticipantId || "").slice(0, 120),
      clientEventId: String(event.clientEventId || event.payload?.clientEventId || "").slice(0, 160),
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
  if (["round_grading", "round_result"].includes(sanitized.type)) {
    // Grading only needs the shared setup and locked submissions. Keep live
    // power state on its dedicated sync path so the grading handoff remains
    // small and can never be delayed by a large effect map.
    const game = sanitized.payload.game && typeof sanitized.payload.game === "object"
      ? sanitized.payload.game
      : null;
    if (game) {
      sanitized.payload.game = {
        matchId: game.matchId,
        status: game.status,
        round: game.round,
        setup: game.setup || null,
        matchSettings: game.matchSettings || null,
        gradingStartedAt: game.gradingStartedAt || 0,
        gradingReason: game.gradingReason || "",
        updatedAt: game.updatedAt || sanitized.payload.updatedAt || event.createdAt || Date.now()
      };
    }
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
  if (!options.includeAnswerDrafts) {
    delete sanitized.answerDraft;
    delete sanitized.currentAnswer;
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
    || body.actorParticipantId
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
  const eventPayload = payload && typeof payload === "object" ? payload : {};
  const actorId = String(eventPayload.actorId || eventPayload.participantId || eventPayload.hostParticipantId || "").slice(0, 120);
  const clientEventId = String(eventPayload.clientEventId || "").slice(0, 160);
  room.revision = revision;
  room.updatedAt = Date.now();
  room.events = [
    ...normalizeRoomEvents(room.events),
    {
      id: `${room.code}-${revision}`,
      roomCode: room.code,
      revision,
      type: String(type || "room_updated").slice(0, 60),
      actorId,
      clientEventId,
      payload: {
        ...eventPayload,
        code: eventPayload.code || room.code,
        roomCode: eventPayload.roomCode || room.code,
        revision,
        updatedAt: room.updatedAt
      },
      createdAt: Date.now()
    }
  ].slice(-maxRoomEvents);
  return room;
}

const serverRoomEventClientTypeMap = {
  answer_draft_updated: "answer-draft",
  settings_updated: "room-settings"
};

function getClientRoomEventType(type = "") {
  const normalizedType = String(type || "room_updated");
  return serverRoomEventClientTypeMap[normalizedType] || normalizedType.replaceAll("_", "-");
}

function getRoomClientEventId(body = {}) {
  return String(body?.clientEventId || body?.clientEventID || body?.eventId || "")
    .trim()
    .slice(0, 160);
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

function getRoomEventsAfterRevision(room, revision = 0, options = {}) {
  const afterRevision = clampServerNumber(revision, 0, Number.MAX_SAFE_INTEGER, 0);
  return normalizeRoomEvents(room?.events)
    .filter((event) => event.revision > afterRevision)
    .map((event) => sanitizeRoomEventForClient(event, options));
}

function getSupabaseRealtimeBroadcastUrl() {
  const url = getSupabaseUrl().replace(/\/+$/g, "");
  return url ? `${url}/realtime/v1/api/broadcast` : "";
}

function getSupabaseRealtimeBroadcastToken() {
  return String(
    process.env.SUPABASE_SERVICE_ROLE_KEY
    || process.env.SUPABASE_ANON_KEY
    || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    || ""
  ).trim();
}

function isServerRealtimeBroadcastEnabled() {
  const mode = String(process.env.SERVER_REALTIME_BROADCAST || "").trim().toLowerCase();
  if (["0", "false", "off", "disabled"].includes(mode)) {
    return false;
  }
  if (["1", "true", "on", "enabled"].includes(mode)) {
    return true;
  }
  return process.env.BACKEND_STORE !== "memory";
}

function shouldBroadcastRoomServerEventToLobby(event = {}) {
  const eventType = getClientRoomEventType(event.type || event.payload?.eventType || "");
  return [
    "host-transferred",
    "participant-joined",
    "participant-updated",
    "participant-left",
    "participant-disconnected",
    "participant-reconnected",
    "participant-moderated",
    "room-settings",
    "room-created",
    "room-updated",
    "room-closed",
    "round-setup-failed",
    "room-deleted"
  ].includes(eventType);
}

function createRoomRoundResultReadyEvent(room, event) {
  const payload = event?.payload && typeof event.payload === "object" ? event.payload : {};
  const roundResult = normalizeRoomRoundResult(payload.roundResult || room?.game?.roundResult || null);
  if (!room || !roundResult) {
    return null;
  }
  return createSyntheticRoomEvent(room, "round_result_ready", {
    clientEventId: payload.clientEventId,
    actorId: event?.actorId || payload.actorId,
    matchId: roundResult.matchId || room.game?.matchId || "",
    round: roundResult.round || room.game?.round || 0,
    resultRevision: Number(event?.revision) || getRoomRevision(room),
    resultUpdatedAt: roundResult.updatedAt || room.updatedAt || Date.now()
  });
}

function createRealtimeBroadcastMessage(topic, event) {
  return {
    topic,
    event: "room-change",
    payload: {
      ...event,
      sourceId: "server"
    }
  };
}

async function scheduleServerRoomRealtimeBroadcast(roomCode = "", events = [], options = {}) {
  const code = String(roomCode || "").trim().toUpperCase();
  const broadcastEvents = Array.isArray(events) ? events.filter((event) => event && typeof event === "object") : [];
  const url = getSupabaseRealtimeBroadcastUrl();
  const token = getSupabaseRealtimeBroadcastToken();
  if (!code || !broadcastEvents.length || !isServerRealtimeBroadcastEnabled() || !url || !token || typeof fetch !== "function") {
    return false;
  }
  const roomTopic = `trivia-against-ai:room:${code}`;
  const messages = [];
  broadcastEvents.forEach((event) => {
    messages.push(createRealtimeBroadcastMessage(roomTopic, event));
    if (shouldBroadcastRoomServerEventToLobby(event)) {
      const lobbyEvent = sanitizeRoomEventForClient(event, { ...options, includeSubmittedAnswers: false });
      messages.push(createRealtimeBroadcastMessage("trivia-against-ai:rooms", lobbyEvent));
    }
  });
  if (!messages.length) {
    return false;
  }
  try {
    const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: token,
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ messages })
    });
    if (!response.ok) {
      throw new Error(`Supabase realtime broadcast failed with HTTP ${response.status}.`);
    }
    return true;
  } catch (error) {
    console.warn("Server realtime broadcast failed:", error?.message || error);
    return false;
  }
}

async function broadcastRoomRoundResultReady(room, event) {
  const readyEvent = createRoomRoundResultReadyEvent(room, event);
  if (!readyEvent) {
    return false;
  }
  return scheduleServerRoomRealtimeBroadcast(room.code, [readyEvent], {
    includeSubmittedAnswers: false
  });
}

async function createRoomCommandResponse(room, previousRevision = 0, options = {}) {
  const events = getRoomEventsAfterRevision(room, previousRevision, options);
  const broadcastSinceRevision = Number.isFinite(Number(options.broadcastSinceRevision))
    ? Math.max(0, Number(options.broadcastSinceRevision))
    : previousRevision;
  const broadcastEvents = broadcastSinceRevision === previousRevision
    ? events
    : getRoomEventsAfterRevision(room, broadcastSinceRevision, options);
  // The server is the only authoritative publisher. Waiting for the publish
  // acknowledgement keeps the command response and the realtime stream on
  // the same ordered path; the initiating browser must never relay a
  // speculative or delayed copy to the other players.
  // A small readiness event follows the full result. It lets a player recover
  // the exact persisted result once when a large websocket payload is missed.
  const resultEvent = broadcastEvents.find((event) => event.type === "round_result");
  // Send both broadcasts concurrently. The full result remains the normal
  // path; the tiny ready signal can arrive first and recover the committed
  // result without making the host wait for two sequential network trips.
  const [serverBroadcast, resultReadyBroadcast] = await Promise.all([
    scheduleServerRoomRealtimeBroadcast(room.code, broadcastEvents, options),
    resultEvent
      ? broadcastRoomRoundResultReady(room, resultEvent)
      : Promise.resolve(false)
  ]);
  return {
    ok: true,
    roomCode: room.code,
    revision: getRoomRevision(room),
    updatedAt: room.updatedAt,
    events,
    serverBroadcast,
    resultReadyBroadcast
  };
}

function normalizeRoomCommandType(type = "") {
  return String(type || "")
    .trim()
    .toLowerCase()
    .replaceAll("-", "_")
    .slice(0, 80);
}

function normalizeRoomCommandBody(body = {}, pathCode = "") {
  const source = body && typeof body === "object" ? body : {};
  const payload = source.payload && typeof source.payload === "object" ? source.payload : {};
  return {
    type: normalizeRoomCommandType(source.type || source.command || source.commandType),
    roomCode: String(source.roomCode || source.code || pathCode || "").trim().toUpperCase(),
    participantId: String(source.participantId || payload.participantId || "").slice(0, 80),
    clientInstanceId: String(source.clientInstanceId || payload.clientInstanceId || "").slice(0, 120),
    tabSessionId: String(source.tabSessionId || payload.tabSessionId || "").slice(0, 120),
    clientEventId: getRoomClientEventId(source),
    expectedRevision: clampServerNumber(source.expectedRevision, 0, Number.MAX_SAFE_INTEGER, 0),
    payload
  };
}

function validateRoomCommandEnvelope(command, room, res) {
  if (!command.type) {
    sendJson(res, 400, { ok: false, error: "Missing room command type." });
    return false;
  }
  if (!command.clientEventId) {
    sendJson(res, 400, { ok: false, error: "Missing clientEventId." });
    return false;
  }
  if (!command.roomCode || command.roomCode !== room.code) {
    sendJson(res, 400, { ok: false, error: "Command room code does not match this room." });
    return false;
  }
  if (command.expectedRevision > getRoomRevision(room)) {
    sendJson(res, 409, {
      ok: false,
      error: "Client expected a future room revision.",
      roomCode: room.code,
      revision: getRoomRevision(room),
      events: []
    });
    return false;
  }
  return true;
}

function getRoomCommandEventsByClientId(room, clientEventId) {
  const normalizedId = String(clientEventId || "").trim().slice(0, 160);
  if (!normalizedId) {
    return [];
  }
  return normalizeRoomEvents(room?.events)
    .filter((event) => event.clientEventId === normalizedId)
    .sort((left, right) => left.revision - right.revision);
}

function getRoomCommandActorId(command = {}) {
  return String(
    command.participantId
      || command.payload?.participantId
      || command.payload?.actorParticipantId
      || command.payload?.hostParticipantId
      || ""
  ).slice(0, 120);
}

async function replayRoomCommandIfAlreadyApplied(req, res, room, command, rawBody = {}) {
  const events = getRoomCommandEventsByClientId(room, command.clientEventId);
  if (!events.length) {
    return false;
  }

  const actorId = getRoomCommandActorId(command);
  const eventActors = new Set(events
    .map((event) => String(event.actorId || event.payload?.actorId || event.payload?.participantId || "").slice(0, 120))
    .filter(Boolean));
  const hostAuthenticated = hasRoomHostAuth(req, room, rawBody);
  if (!hostAuthenticated && actorId && eventActors.size && !eventActors.has(actorId)) {
    // Do not expose a previous command's result to another participant that
    // happened to reuse its id. The normal handler will perform auth checks.
    return false;
  }

  const includeSubmittedAnswers = shouldExposeRoomAnswers(room, { includePrivateSecrets: hostAuthenticated });
  const replayEvents = events.map((event) => sanitizeRoomEventForClient(event, {
    includeSubmittedAnswers,
    includePrivateSecrets: hostAuthenticated
  }));
  // Persistence and delivery are separate operations. A command can be
  // committed successfully while the original realtime publish is lost or
  // while the initiating request times out. Republish the same immutable
  // event ids on an idempotent retry so subscribers can recover immediately;
  // their event-id/revision dedupe makes this safe when the first publish did
  // arrive.
  const serverBroadcast = await scheduleServerRoomRealtimeBroadcast(room.code, replayEvents, {
    includeSubmittedAnswers,
    includePrivateSecrets: hostAuthenticated
  });
  const response = {
    ok: true,
    roomCode: room.code,
    revision: getRoomRevision(room),
    updatedAt: room.updatedAt,
    duplicate: true,
    serverBroadcast,
    events: replayEvents
  };
  const participantId = String(command.participantId || "").slice(0, 80);
  if (participantId) {
    const participant = room.participants.find((entry) => entry.id === participantId);
    if (participant) {
      response.participant = sanitizeParticipantForClient(participant, {
        includeSubmittedAnswers: true,
        includePrivateSecrets: hostAuthenticated
      });
    }
  }
  if (rawBody.includeRoom || rawBody.includeRoomSnapshot) {
    response.room = sanitizeRoomForClient(room, { includePrivateSecrets: hostAuthenticated });
  }
  const participantCookie = participantId && room.participants.some((entry) => entry.id === participantId)
    ? createRoomParticipantCookie(req, room, participantId)
    : "";
  sendJson(res, 200, response, participantCookie ? { "Set-Cookie": participantCookie } : {});
  return true;
}

async function handleRoomCommandCreateRoom(req, res, normalizedCode, command, rawBody = {}) {
  if (!command.type) {
    sendJson(res, 400, { ok: false, error: "Missing room command type." });
    return;
  }
  if (!command.clientEventId) {
    sendJson(res, 400, { ok: false, error: "Missing clientEventId." });
    return;
  }
  if (!command.roomCode || command.roomCode !== normalizedCode) {
    sendJson(res, 400, { ok: false, error: "Command room code does not match this room." });
    return;
  }

  const recentClose = await backendStore.getRoomClose(normalizedCode);
  if (recentClose && recentClose.reason !== "admin-delete") {
    sendJson(res, 409, {
      ok: false,
      error: "Room was recently closed.",
      closed: true,
      close: recentClose,
      roomCode: normalizedCode,
      revision: 0,
      events: []
    });
    return;
  }

  const rawRoom = command.payload.room && typeof command.payload.room === "object"
    ? command.payload.room
    : rawBody.room && typeof rawBody.room === "object"
      ? rawBody.room
      : command.payload;
  const room = normalizeRoom({
    ...(rawRoom && typeof rawRoom === "object" ? rawRoom : {}),
    code: normalizedCode,
    status: rawRoom?.status || "lobby"
  });
  room.security = createRoomSecurity();
  room.events = [];
  room.revision = 0;
  const hostParticipant = getRoomHostParticipant(room);
  if (hostParticipant) {
    ensureRoomParticipantToken(room, hostParticipant.id);
  }
  const transferredRooms = await transferExistingHostRooms(room);
  stampRoomEvent(room, "room_created", {
    clientEventId: command.clientEventId,
    actorId: command.participantId || room.host?.id || hostParticipant?.id || "",
    status: room.status,
    settings: sanitizeRoomSettingsForClient(room.settings, { includePrivateSecrets: true }),
    host: room.host,
    participant: hostParticipant ? sanitizeParticipantForClient(hostParticipant) : null,
    room: sanitizeRoomForClient(room, { includePrivateSecrets: true })
  });
  const storedRoom = await backendStore.upsertRoom(room);
  sendJson(res, 200, {
    ...(await createRoomCommandResponse(storedRoom, 0, { includePrivateSecrets: true })),
    room: sanitizeRoomForClient(storedRoom, { includePrivateSecrets: true }),
    transferredRooms: transferredRooms.map((entry) => sanitizeRoomForClient(entry))
  }, { "Set-Cookie": createRoomHostCookie(req, storedRoom) });
}

function enqueueRoomCommand(code, work) {
  const normalizedCode = String(code || "").trim().toUpperCase();
  const previous = roomCommandQueues.get(normalizedCode) || Promise.resolve();
  const next = previous.catch(() => {}).then(() => (
    typeof backendStore.withRoomLock === "function"
      ? backendStore.withRoomLock(normalizedCode, work)
      : work()
  ));
  const queued = next.finally(() => {
    if (roomCommandQueues.get(normalizedCode) === queued) {
      roomCommandQueues.delete(normalizedCode);
    }
  });
  roomCommandQueues.set(normalizedCode, queued);
  return next;
}

async function handleRoomCommand(req, res, code) {
  try {
    const normalizedCode = String(code || "").trim().toUpperCase();
    const body = await readRequestJson(req, { maxBytes: roomRequestMaxBytes });
    const command = normalizeRoomCommandBody(body, normalizedCode);
    await enqueueRoomCommand(normalizedCode, () => handleRoomCommandParsed(req, res, normalizedCode, command, body));
  } catch (error) {
    const message = String(error?.message || "Room command failed.");
    if (message.toLowerCase().includes("room is busy processing another command")) {
      sendJson(res, 503, {
        ok: false,
        retryable: true,
        retryAfterMs: 750,
        error: "Room is syncing another action. Please try again in a moment."
      }, {
        "Retry-After": "1"
      });
      return;
    }
    sendJson(res, 400, { ok: false, error: message });
  }
}

async function handleRoomCommandParsed(req, res, normalizedCode, command, body) {
  const room = await backendStore.getRoom(normalizedCode);
  if (!room) {
    if (command.type === "create_room") {
      await handleRoomCommandCreateRoom(req, res, normalizedCode, command, body);
      return;
    }
    sendJson(res, 404, { ok: false, error: "Room not found." });
    return;
  }

    if (!validateRoomCommandEnvelope(command, room, res)) {
      return;
    }
    if (await replayRoomCommandIfAlreadyApplied(req, res, room, command, body)) {
      return;
    }

    if (command.type === "create_room") {
      sendJson(res, 409, {
        ok: false,
        roomCode: room.code,
        revision: getRoomRevision(room),
        error: "Room already exists.",
        events: []
      });
      return;
    }
    if (command.type === "join_room" || command.type === "rejoin_room") {
      await handleRoomCommandParticipantPresence(req, res, room, command, body, {
        active: true,
        defaultStatus: command.type === "rejoin_room" ? "joined" : ""
      });
      return;
    }
    if (command.type === "disconnect_participant") {
      await handleRoomCommandParticipantPresence(req, res, room, command, body, {
        active: false,
        defaultStatus: "disconnected"
      });
      return;
    }
    if (command.type === "update_answer_draft") {
      await handleRoomCommandUpdateAnswerDraft(req, res, room, command, body);
      return;
    }
    if (command.type === "submit_answer") {
      await handleRoomCommandSubmitAnswer(req, res, room, command, body);
      return;
    }
    if (command.type === "use_hint") {
      await handleRoomCommandUseHint(req, res, room, command, body);
      return;
    }
    if (command.type === "add_bot") {
      await handleRoomCommandAddBot(req, res, room, command, body);
      return;
    }
    if (command.type === "start_match" || command.type === "start_next_round" || command.type === "rematch" || command.type === "resolve_auto_advance") {
      await handleRoomCommandStartRound(req, res, room, command, body);
      return;
    }
    if (command.type === "resolve_all_submitted") {
      await handleRoomCommandResolveAllSubmitted(req, res, room, command, body);
      return;
    }
    if (command.type === "prepare_round") {
      await handleRoomCommandPrepareRound(req, res, room, command, body);
      return;
    }
    if (command.type === "update_settings") {
      await handleRoomCommandUpdateSettings(req, res, room, command, body);
      return;
    }
    if (command.type === "moderate_participant") {
      await handleRoomCommandModerateParticipant(req, res, room, command, body);
      return;
    }
    if (command.type === "transfer_host") {
      await handleRoomCommandTransferHost(req, res, room, command, body);
      return;
    }
    if (command.type === "skip_to_grading" || command.type === "resolve_timer_expired") {
      await handleRoomCommandMoveToGrading(req, res, room, command, body);
      return;
    }
    if (command.type === "publish_round_result") {
      await handleRoomCommandPublishRoundResult(req, res, room, command, body);
      return;
    }
    if (command.type === "end_game") {
      await handleRoomCommandEndGame(req, res, room, command, body);
      return;
    }
    if (command.type === "return_to_lobby") {
      await handleRoomCommandReturnToLobby(req, res, room, command, body);
      return;
    }
    if (command.type === "send_chat") {
      await handleRoomCommandSendChat(req, res, room, command, body);
      return;
    }
    if (command.type === "use_power") {
      await handleRoomCommandUsePower(req, res, room, command, body);
      return;
    }
    if (command.type === "leave_room") {
      await handleRoomCommandLeaveRoom(req, res, room, command, body);
      return;
    }

  sendJson(res, 501, {
    ok: false,
    roomCode: room.code,
    revision: getRoomRevision(room),
    error: `Room command ${command.type} is not implemented yet.`
  });
}

async function handleRoomCommandUpdateAnswerDraft(req, res, room, command, rawBody = {}) {
  const participantId = command.participantId;
  if (!participantId) {
    sendJson(res, 400, { ok: false, error: "Missing participant id." });
    return;
  }
  if (!requireRoomParticipantAuth(req, res, room, participantId, rawBody, "Only this participant can update their answer draft.")) {
    return;
  }
  const participant = room.participants.find((entry) => entry.id === participantId);
  if (!participant || participant.active === false) {
    sendJson(res, 404, { ok: false, error: "Participant is not active in this room." });
    return;
  }
  if (normalizeParticipantRole(participant) === "spectator") {
    sendJson(res, 403, { ok: false, error: "Spectators cannot update gameplay answer drafts." });
    return;
  }
  const game = room.game && typeof room.game === "object" ? room.game : null;
  const matchId = String(command.payload.matchId || game?.matchId || "").slice(0, 80);
  const round = clampServerNumber(command.payload.round || game?.round, 0, 100, 0);
  if (room.status !== "in-progress" || !game || game.status === "grading" || game.status === "ended") {
    sendJson(res, 409, { ok: false, error: "This round is not accepting answer drafts." });
    return;
  }
  if (game.matchId && matchId && matchId !== game.matchId) {
    sendJson(res, 409, { ok: false, error: "Answer draft belongs to a previous match." });
    return;
  }
  if (game.round && round && Number(round) !== Number(game.round)) {
    sendJson(res, 409, { ok: false, error: "Answer draft belongs to a different round." });
    return;
  }

  const previousRevision = getRoomRevision(room);
  const draft = String(command.payload.answer ?? command.payload.draft ?? "").replace(/\s+/g, " ").slice(0, 500);
  participant.answerDraft = draft;
  participant.currentAnswer = draft;
  participant.lastSeenAt = Date.now();
  stampRoomEvent(room, "answer_draft_updated", {
    clientEventId: command.clientEventId,
    actorId: participantId,
    participantId,
    clientInstanceId: command.clientInstanceId,
    matchId: game.matchId || matchId,
    round: game.round || round,
    answer: draft
  });
  finalizeRoom(room);
  const storedRoom = await backendStore.upsertRoom(room);
  sendJson(res, 200, await createRoomCommandResponse(storedRoom, previousRevision, {
    includeSubmittedAnswers: true
  }));
}

async function handleRoomCommandSubmitAnswer(req, res, room, command, rawBody = {}) {
  const participantId = command.participantId;
  if (!participantId) {
    sendJson(res, 400, { ok: false, error: "Missing participant id." });
    return;
  }
  if (!requireRoomParticipantAuth(req, res, room, participantId, rawBody, "Only this participant or the host can submit this answer.")) {
    return;
  }

  const participant = room.participants.find((entry) => entry.id === participantId);
  if (!participant || participant.active === false) {
    sendJson(res, 404, { ok: false, error: "Participant is not active in this room." });
    return;
  }
  if (normalizeParticipantRole(participant) === "spectator") {
    sendJson(res, 403, { ok: false, error: "Spectators cannot submit gameplay answers." });
    return;
  }

  const game = room.game && typeof room.game === "object" ? room.game : null;
  const currentMatchId = String(game?.matchId || "").slice(0, 80);
  const currentRound = clampServerNumber(game?.round, 0, 100, 0);
  const payloadMatchId = String(command.payload.matchId || "").slice(0, 80);
  const payloadRound = clampServerNumber(command.payload.round, 0, 100, 0);
  if (room.status !== "in-progress" || !game || game.status === "starting" || game.status === "grading" || game.status === "ended") {
    sendJson(res, 409, { ok: false, error: "This round is not accepting answers." });
    return;
  }
  if (!currentMatchId || !payloadMatchId || payloadMatchId !== currentMatchId) {
    sendJson(res, 409, { ok: false, error: "Answer belongs to a previous match." });
    return;
  }
  if (!currentRound || !payloadRound || payloadRound !== currentRound) {
    sendJson(res, 409, { ok: false, error: "Answer belongs to a previous round." });
    return;
  }

  const previousRevision = getRoomRevision(room);
  const existingAnswers = normalizeRoomAnswerState(game.answers, currentMatchId, currentRound);
  const existingAnswer = existingAnswers[participantId];
  if (existingAnswer && existingAnswer.matchId === currentMatchId && Number(existingAnswer.round) === currentRound) {
    const gradingTransition = startRoomGradingTransition(room, {
      reason: "all-submitted",
      force: false,
      clientEventId: command.clientEventId
    });
    if (gradingTransition.started) {
      finalizeRoom(room);
      const storedRoom = await backendStore.upsertRoom(room);
      sendJson(res, 200, {
        ...(await createRoomCommandResponse(storedRoom, previousRevision, {
          includeSubmittedAnswers: true
        })),
        duplicate: true,
        answer: existingAnswer.answer || "",
        remainingTime: clampServerNumber(existingAnswer.remainingTime, 0, 600, 0),
        submissionStatus: existingAnswer.status || "submitted",
        autoSubmitted: Boolean(existingAnswer.autoSubmitted)
      });
      return;
    }
    sendJson(res, 200, {
      ok: true,
      roomCode: room.code,
      revision: getRoomRevision(room),
      updatedAt: room.updatedAt,
      duplicate: true,
      events: []
    });
    return;
  }

  const answerStatus = command.payload.timedOut || String(command.payload.status || "").toLowerCase() === "timed_out"
    ? "timed_out"
    : "submitted";
  const answer = String(command.payload.answer || "").trim().slice(0, 500);
  const remainingTime = clampServerNumber(command.payload.remainingTime, 0, 600, 0);
  const submittedAt = Date.now();
  const answerState = {
    participantId,
    status: answerStatus,
    answer,
    submittedAt,
    autoSubmitted: Boolean(command.payload.autoSubmitted || answerStatus === "timed_out"),
    usedHint: Boolean(command.payload.usedHint || game.hints?.[participantId]?.usedRounds?.[String(currentRound)]),
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
  participant.currentAnswer = answer;
  participant.answerDraft = answer;
  participant.submittedRound = currentRound;
  participant.submissionMatchId = currentMatchId;
  participant.remainingTime = remainingTime;
  participant.submittedAt = submittedAt;
  participant.usedHintRound = answerState.usedHint ? currentRound : 0;

  autoSubmitRoomBotsWhenOnlyBotsPending(room, {
    matchId: currentMatchId,
    round: currentRound,
    clientEventId: command.clientEventId
  });
  const submissionStatusSnapshot = getRoomSubmissionStatusSnapshot(room, currentMatchId, currentRound);
  stampRoomEvent(room, "answer_submitted", {
    clientEventId: command.clientEventId,
    actorId: participantId,
    participantId,
    participantName: participant.name || "A player",
    role: normalizeParticipantRole(participant),
    host: Boolean(participant.host),
    spectator: false,
    status: participant.status,
    participant: sanitizeParticipantForClient(participant, { includeSubmittedAnswers: true }),
    matchId: currentMatchId,
    round: currentRound,
    answer,
    remainingTime,
    submissionStatus: answerStatus,
    autoSubmitted: answerState.autoSubmitted,
    usedHint: answerState.usedHint,
    submissionStatusSnapshot
  });
  startRoomGradingTransition(room, {
    reason: "all-submitted",
    force: false,
    clientEventId: command.clientEventId
  });
  finalizeRoom(room);
  const storedRoom = await backendStore.upsertRoom(room);
  sendJson(res, 200, await createRoomCommandResponse(storedRoom, previousRevision, {
    includeSubmittedAnswers: true
  }));
}

async function handleRoomCommandUseHint(req, res, room, command, rawBody = {}) {
  const participantId = String(command.participantId || "").slice(0, 80);
  if (!participantId) {
    sendJson(res, 400, { ok: false, error: "Missing participant id." });
    return;
  }
  if (!requireRoomParticipantAuth(req, res, room, participantId, rawBody, "Only this participant can use a hint.")) {
    return;
  }
  const participant = room.participants.find((entry) => String(entry.id || "") === participantId);
  const game = room.game && typeof room.game === "object" ? room.game : null;
  const setup = game?.setup && typeof game.setup === "object" ? game.setup : null;
  const matchId = String(game?.matchId || "").slice(0, 80);
  const round = clampServerNumber(game?.round, 0, 100, 0);
  const payloadMatchId = String(command.payload.matchId || "").slice(0, 80);
  const payloadRound = clampServerNumber(command.payload.round, 0, 100, 0);
  if (!participant || participant.active === false || normalizeParticipantRole(participant) === "spectator") {
    sendJson(res, 404, { ok: false, error: "Participant is not active in this room." });
    return;
  }
  if (room.status !== "in-progress" || !game || game.status !== "playing" || !setup) {
    sendJson(res, 409, { ok: false, error: "Hints are only available during the answering phase." });
    return;
  }
  if (!matchId || payloadMatchId !== matchId || !round || payloadRound !== round) {
    sendJson(res, 409, { ok: false, error: "This hint belongs to a previous round." });
    return;
  }
  const hints = normalizeRoomHintStateMap(game.hints);
  const previousHintState = hints[participantId] || {
    matchId,
    freeRemaining: 1,
    purchasesUsed: 0,
    usedRounds: {}
  };
  previousHintState.matchId = matchId;
  if (previousHintState.usedRounds[String(round)]) {
    sendJson(res, 409, { ok: false, error: "You can only use one hint per round." });
    return;
  }
  const paid = Boolean(command.payload.paid);
  if (previousHintState.freeRemaining <= 0 && !paid) {
    sendJson(res, 409, { ok: false, error: "Your free hint has already been used." });
    return;
  }
  if (paid && previousHintState.purchasesUsed >= 2) {
    sendJson(res, 409, { ok: false, error: "You can only purchase two hints per match." });
    return;
  }
  const isMultipleChoice = setup.questionStyle === "multiple-choice";
  const hasCanonicalAnswer = Boolean(String(setup.canonicalAnswer || "").trim());
  if (!isMultipleChoice && !hasCanonicalAnswer) {
    sendJson(res, 409, { ok: false, error: "This question does not have an answer available for a hint." });
    return;
  }
  let hint = "";
  let removedOption = "";
  if (isMultipleChoice) {
    const options = Array.isArray(setup.multipleChoiceOptions) ? setup.multipleChoiceOptions : [];
    const canonical = String(setup.canonicalAnswer || "").trim().toLowerCase();
    const wrongOptions = options.filter((option) => String(option || "").trim().toLowerCase() !== canonical);
    if (wrongOptions.length) {
      const index = Math.abs(hashString(`${matchId}:${round}:${participantId}:hint`)) % wrongOptions.length;
      removedOption = String(wrongOptions[index] || "").slice(0, 120);
    }
    hint = "One incorrect option was removed.";
  } else {
    const answer = String(setup.canonicalAnswer || "").trim();
    hint = answer.split(/\s+/).filter(Boolean).map((word) => {
      let revealed = false;
      return Array.from(word).map((character) => {
        if (/\p{L}|\p{N}/u.test(character)) {
          if (!revealed) {
            revealed = true;
            return character.toLocaleUpperCase();
          }
          return "_";
        }
        return character;
      }).join(" ");
    }).join("   ");
  }
  const nextHintState = {
    ...previousHintState,
    freeRemaining: Math.max(0, previousHintState.freeRemaining - (paid ? 0 : 1)),
    purchasesUsed: previousHintState.purchasesUsed + (paid ? 1 : 0),
    usedRounds: { ...previousHintState.usedRounds, [String(round)]: true }
  };
  const previousRevision = getRoomRevision(room);
  room.game = normalizeRoomGame({
    ...game,
    hints: { ...hints, [participantId]: nextHintState },
    updatedAt: Date.now()
  });
  stampRoomEvent(room, "hint_used", {
    clientEventId: command.clientEventId,
    actorId: participantId,
    participantId,
    matchId,
    round,
    hintUsed: true,
    paid,
    hintState: nextHintState
  });
  finalizeRoom(room);
  const storedRoom = await backendStore.upsertRoom(room);
  sendJson(res, 200, {
    ...(await createRoomCommandResponse(storedRoom, previousRevision, { includeSubmittedAnswers: true })),
    hint,
    removedOption,
    hintState: nextHintState
  });
}

async function handleRoomCommandAddBot(req, res, room, command, rawBody = {}) {
  if (!requireRoomHostAuth(req, res, room, rawBody, "Only the host can add bots.")) {
    return;
  }
  if (room.status !== "lobby") {
    sendJson(res, 409, { ok: false, error: "Bots can only be added in the lobby." });
    return;
  }
  const activePlayers = room.participants.filter(isGameplayParticipant).length;
  const maxPlayers = clampServerNumber(room.settings?.maxPlayers, 2, 10, 6);
  if (activePlayers >= maxPlayers) {
    sendJson(res, 409, { ok: false, error: "Room is full." });
    return;
  }

  const previousRevision = getRoomRevision(room);
  const requestedParticipant = command.payload.participant && typeof command.payload.participant === "object" ? command.payload.participant : {};
  const requestedName = String(command.payload.name || command.payload.botName || requestedParticipant.name || "Bot").trim().slice(0, 24) || "Bot";
  const existingNames = new Set(room.participants.map((participant) => String(participant.name || "").trim().toLowerCase()));
  let botName = requestedName;
  if (existingNames.has(botName.toLowerCase())) {
    let suffix = 2;
    while (existingNames.has(`${requestedName} ${suffix}`.toLowerCase())) {
      suffix += 1;
    }
    botName = `${requestedName} ${suffix}`.slice(0, 24);
  }
  const requestedBotId = String(requestedParticipant.id || command.payload.botId || "").trim().slice(0, 80);
  const existingIds = new Set(room.participants.map((participant) => String(participant.id || "")));
  const botId = requestedBotId && !existingIds.has(requestedBotId)
    ? requestedBotId
    : `bot-${room.code}-${Date.now()}-${randomBytes(4).toString("hex")}`.slice(0, 80);
  const bot = normalizeParticipant({
    id: botId,
    name: botName,
    avatar: "",
    equippedTitleId: "",
    specialBadges: [],
    cardCustomization: null,
    role: "bot",
    host: false,
    spectator: false,
    bot: true,
    active: true,
    muted: false,
    status: "bot",
    joinedAt: Date.now()
  });
  room.participants.push(bot);
  finalizeRoom(room);
  const storedBot = room.participants.find((participant) => participant.id === bot.id) || bot;
  stampRoomEvent(room, "participant_joined", {
    clientEventId: command.clientEventId,
    actorId: command.participantId,
    participantId: storedBot.id,
    participantName: storedBot.name || "Bot",
    role: "bot",
    host: false,
    spectator: false,
    status: "bot",
    participant: sanitizeParticipantForClient(storedBot),
    bot: true
  });
  const storedRoom = await backendStore.upsertRoom(room);
  sendJson(res, 200, await createRoomCommandResponse(storedRoom, previousRevision));
}

async function handleRoomCommandStartRound(req, res, room, command, rawBody = {}) {
  if (!requireRoomHostAuth(req, res, room, rawBody, "Only the host can start or advance this match.")) {
    return;
  }
  const isRematch = command.type === "rematch";
  const isAutoAdvance = command.type === "resolve_auto_advance";
  const isStartMatch = command.type === "start_match" || isRematch;
  const activePlayers = room.participants.filter(isGameplayParticipant).length;
  if (isStartMatch && room.status !== "lobby" && !(isRematch && room.status === "complete")) {
    sendJson(res, 409, { ok: false, error: "Match can only be started from the lobby." });
    return;
  }
  if (activePlayers < 2) {
    sendJson(res, 409, { ok: false, error: "Need at least 2 active players before starting the match." });
    return;
  }

  const previousRevision = getRoomRevision(room);
  const stableRoomBeforePreparation = cloneRoomStateForRecovery(room);
  const currentGame = room.game && typeof room.game === "object" ? room.game : null;
  const currentMatchId = String(currentGame?.matchId || "").slice(0, 80);
  const payloadMatchId = String(command.payload.matchId || "").slice(0, 80);
  const startsNewMatch = isStartMatch
    || room.status === "lobby"
    || room.status === "complete"
    || currentGame?.status === "ended";
  if (isAutoAdvance) {
    const roundResult = normalizeRoomRoundResult(currentGame?.roundResult || null);
    const nextRoundAt = clampServerNumber(roundResult?.nextRoundAt, 0, Number.MAX_SAFE_INTEGER, 0);
    if (room.settings?.autoAdvance === false || currentGame?.matchSettings?.autoAdvance === false) {
      sendJson(res, 409, { ok: false, error: "Auto advance is disabled for this room." });
      return;
    }
    if (!roundResult || !nextRoundAt) {
      sendJson(res, 409, { ok: false, error: "This round is not ready for auto advance." });
      return;
    }
    if (Date.now() < nextRoundAt) {
      sendJson(res, 409, {
        ok: false,
        error: "Auto advance deadline has not arrived yet.",
        nextRoundAt,
        roomCode: room.code,
        revision: getRoomRevision(room),
        events: []
      });
      return;
    }
  }
  const matchId = startsNewMatch
    ? (payloadMatchId || `${room.code}-${Date.now()}`)
    : (payloadMatchId || currentMatchId || `${room.code}-${Date.now()}`);
  const currentRound = clampServerNumber(currentGame?.round, 0, 100, 0);
  const round = clampServerNumber(
    command.payload.round || command.payload.nextRound,
    1,
    100,
    startsNewMatch ? 1 : currentRound || 1
  );
  const roomIsActiveMatch = room.status === "in-progress" && currentGame && currentGame.status !== "ended";
  if (!isStartMatch && roomIsActiveMatch && currentMatchId && payloadMatchId && payloadMatchId !== currentMatchId) {
    sendJson(res, 409, { ok: false, error: "Round advance belongs to a previous match." });
    return;
  }
  if (!isStartMatch && roomIsActiveMatch && currentRound && round < currentRound) {
    sendJson(res, 409, { ok: false, error: "Round advance belongs to a previous round." });
    return;
  }
  if (
    !isStartMatch
    && roomIsActiveMatch
    && currentRound
    && round === currentRound
    && currentGame.setup
    && currentGame.status !== "starting"
  ) {
    sendJson(res, 200, {
      ok: true,
      roomCode: room.code,
      revision: getRoomRevision(room),
      updatedAt: room.updatedAt,
      duplicate: true,
      events: []
    });
    return;
  }

  const matchSettings = normalizeRoomGameSettings(command.payload.matchSettings || command.payload.settings || currentGame?.matchSettings || room.settings);
  const questionLanguage = normalizeQuestionLanguage(
    command.payload.questionLanguage
      || command.payload.language
      || command.payload.matchSettings?.questionLanguage
      || command.payload.settings?.questionLanguage
      || room.settings?.questionLanguage
      || matchSettings.questionLanguage
  );
  matchSettings.questionLanguage = questionLanguage;
  const requestedPowerState = command.payload.powerState && typeof command.payload.powerState === "object"
    ? command.payload.powerState
    : null;
  const initialPowerState = startsNewMatch
    ? requestedPowerState && String(requestedPowerState.matchId || "") === matchId
      ? requestedPowerState
      : null
    : requestedPowerState || currentGame?.powerState || null;
  applyRoomRoundPreparationState(room, {
    normalizedCode: room.code,
    currentGame: startsNewMatch ? null : currentGame,
    matchId,
    round,
    matchSettings,
    hostParticipantId: command.participantId,
    clientEventId: command.clientEventId,
    powerState: initialPowerState
  });

  // Publish the authoritative preparing state before question generation. This
  // lets every connected client leave the lobby immediately while the server
  // finishes preparing the shared question.
  finalizeRoom(room);
  const preparingRoom = await backendStore.upsertRoom(room);
  const preparationRevision = getRoomRevision(preparingRoom);
  const preparationBroadcast = await scheduleServerRoomRealtimeBroadcast(
    preparingRoom.code,
    getRoomEventsAfterRevision(preparingRoom, previousRevision, { includeSubmittedAnswers: true }),
    { includeSubmittedAnswers: true }
  );

  const enabledThemes = normalizeEnabledThemes(command.payload.enabledThemes || matchSettings.enabledThemes || room.settings?.enabledThemes);
  const preferredTheme = normalizePreferredTheme(command.payload.preferredTheme, enabledThemes);
  const recentBlackCards = Array.isArray(command.payload.recentBlackCards) ? command.payload.recentBlackCards.map(String).slice(-30) : [];
  const totalRounds = clampServerNumber(command.payload.totalRounds || matchSettings.rounds || room.settings?.rounds, 1, 100, matchSettings.rounds || 10);
  const setupSeed = String(command.payload.setupSeed || `${Date.now()}-${Math.random()}`).slice(0, 80);
  let setup;
  try {
    setup = await getSeedQuestionSetup({
      recentBlackCards,
      enabledThemes,
      preferredTheme,
      questionLanguage,
      setupSeed,
      backgroundMode: false,
      round,
      totalRounds
    });
  } catch {
    const recovery = restoreRoomAfterRoundSetupFailure(room, stableRoomBeforePreparation, command);
    const storedRoom = await backendStore.upsertRoom(recovery.room);
    sendJson(res, 409, {
      ...(await createRoomCommandResponse(storedRoom, previousRevision, {
        includeSubmittedAnswers: true,
        broadcastSinceRevision: preparationBroadcast ? preparationRevision : previousRevision
      })),
      ok: false,
      recovery: true,
      error: recovery.message,
      game: storedRoom.game || null
    });
    return;
  }
  if (!setup) {
    const recovery = restoreRoomAfterRoundSetupFailure(room, stableRoomBeforePreparation, command);
    const storedRoom = await backendStore.upsertRoom(recovery.room);
    sendJson(res, 409, {
      ...(await createRoomCommandResponse(storedRoom, previousRevision, {
        includeSubmittedAnswers: true,
        broadcastSinceRevision: preparationBroadcast ? preparationRevision : previousRevision
      })),
      ok: false,
      recovery: true,
      error: recovery.message,
      game: storedRoom.game || null
    });
    return;
  }

  const now = Date.now();
  const timerState = createRoomTimerState(room, matchSettings, now);
  room.participants = room.participants.map((participant) => {
    if (!isGameplayParticipant(participant)) {
      return participant;
    }
    const role = normalizeParticipantRole(participant);
    return {
      ...participant,
      status: "playing",
      answer: "",
      answerDraft: "",
      currentAnswer: "",
      submittedRound: 0,
      submissionMatchId: "",
      remainingTime: 0,
      submittedAt: 0,
      usedHintRound: 0,
      role,
      host: role === "host",
      bot: role === "bot",
      spectator: false
    };
  });
  room.game = normalizeRoomGame({
    ...(room.game || {}),
    matchId,
    status: "playing",
    round,
    setup,
    answers: {},
    matchSettings,
    roundResult: null,
    powerState: initialPowerState,
    setupStartedAt: room.game?.setupStartedAt || now,
    roundStartedAt: now,
    baseDurationMs: timerState.baseDurationMs,
    participantTimers: timerState.participantTimers,
    gradingForceAt: timerState.gradingForceAt,
    updatedAt: now
  });
  stampRoomEvent(room, "round_started", {
    clientEventId: command.clientEventId,
    round,
    matchId,
    game: room.game
  });
  finalizeRoom(room);
  const storedRoom = await backendStore.upsertRoom(room);
  sendJson(res, 200, {
    // Include both round_advancing and round_started so a delayed first
    // publish cannot leave joined clients waiting for a missing revision.
    ...(await createRoomCommandResponse(storedRoom, previousRevision, {
      includeSubmittedAnswers: true,
      broadcastSinceRevision: preparationRevision
    })),
    game: storedRoom.game || room.game
  });
}

function createSyntheticRoomEvent(room, type, payload = {}) {
  const revision = getRoomRevision(room);
  const createdAt = Date.now();
  return sanitizeRoomEventForClient({
    id: `${room.code}-${revision}-${type}`,
    roomCode: room.code,
    revision,
    type,
    actorId: String(payload.actorId || payload.participantId || payload.hostParticipantId || "").slice(0, 120),
    clientEventId: String(payload.clientEventId || "").slice(0, 160),
    payload: {
      ...payload,
      code: payload.code || room.code,
      roomCode: payload.roomCode || room.code,
      revision,
      updatedAt: room.updatedAt || createdAt
    },
    createdAt
  }, { includeSubmittedAnswers: true });
}

function getCanonicalRoomRoundResultEvent(room, roundResult, options = {}) {
  const expectedResult = normalizeRoomRoundResult(roundResult);
  if (!room || !expectedResult) {
    return null;
  }
  const expectedMatchId = String(expectedResult.matchId || room.game?.matchId || "").trim();
  const expectedRound = Number(expectedResult.round || room.game?.round || 0);
  const event = normalizeRoomEvents(room.events)
    .filter((entry) => entry.type === "round_result")
    .reverse()
    .find((entry) => {
      const eventResult = normalizeRoomRoundResult(entry.payload?.roundResult || null);
      return eventResult
        && Number(eventResult.round) === expectedRound
        && (!expectedMatchId || !eventResult.matchId || eventResult.matchId === expectedMatchId);
    });
  if (!event) {
    return null;
  }
  return sanitizeRoomEventForClient(event, {
    includeSubmittedAnswers: options.includeSubmittedAnswers !== false,
    includePrivateSecrets: options.includePrivateSecrets === true
  });
}

async function handleRoomCommandResolveAllSubmitted(req, res, room, command, rawBody = {}) {
  if (!requireRoomParticipantAuth(req, res, room, command.participantId, rawBody, "Only a room participant can resolve submitted answers.")) {
    return;
  }

  const game = room.game && typeof room.game === "object" ? room.game : null;
  const currentMatchId = String(game?.matchId || "").slice(0, 80);
  const currentRound = clampServerNumber(game?.round, 0, 100, 0);
  const payloadMatchId = String(command.payload.matchId || "").slice(0, 80);
  const payloadRound = clampServerNumber(command.payload.round, 0, 100, 0);
  if (room.status !== "in-progress" || !game || game.status === "starting" || game.status === "ended") {
    sendJson(res, 409, { ok: false, error: "This round cannot move to grading." });
    return;
  }
  if (!currentMatchId || !payloadMatchId || payloadMatchId !== currentMatchId) {
    sendJson(res, 409, { ok: false, error: "Resolve request belongs to a previous match." });
    return;
  }
  if (!currentRound || !payloadRound || payloadRound !== currentRound) {
    sendJson(res, 409, { ok: false, error: "Resolve request belongs to a previous round." });
    return;
  }

  const previousRevision = getRoomRevision(room);
  autoSubmitRoomBotsWhenOnlyBotsPending(room, {
    matchId: currentMatchId,
    round: currentRound,
    clientEventId: command.clientEventId
  });
  const transition = startRoomGradingTransition(room, {
    reason: "all-submitted",
    force: false,
    matchId: currentMatchId,
    round: currentRound,
    submissions: command.payload.submissions,
    clientEventId: command.clientEventId
  });
  if (!transition.started && !transition.duplicate) {
    sendJson(res, 409, {
      ok: false,
      error: "Round still has pending answers.",
      roomCode: room.code,
      revision: getRoomRevision(room),
      pendingParticipantIds: transition.pendingParticipantIds,
      events: []
    });
    return;
  }

  finalizeRoom(room);
  const storedRoom = await backendStore.upsertRoom(room);
  const response = await createRoomCommandResponse(storedRoom, previousRevision, {
    includeSubmittedAnswers: true
  });
  if (transition.duplicate && !response.events.length && transition.payload) {
    const syntheticEvent = createSyntheticRoomEvent(storedRoom, "round_grading", transition.payload);
    response.events = [syntheticEvent];
    // The normal response was already broadcast before the synthetic retry
    // event was created. Publish the retry too so a client recovering from a
    // missed grading event does not depend on the host rebroadcasting it.
    response.serverBroadcast = await scheduleServerRoomRealtimeBroadcast(
      storedRoom.code,
      response.events,
      { includeSubmittedAnswers: true }
    );
  }
  sendJson(res, 200, response);
}

async function handleRoomCommandPrepareRound(req, res, room, command, rawBody = {}) {
  if (!requireRoomHostAuth(req, res, room, rawBody, "Only the host can prepare a room round.")) {
    return;
  }

  const previousRevision = getRoomRevision(room);
  const stableRoomBeforePreparation = cloneRoomStateForRecovery(room);
  let currentGame = room.game && typeof room.game === "object" ? room.game : null;
  let currentMatchId = String(currentGame?.matchId || "").slice(0, 80);
  const payloadMatchId = String(command.payload.matchId || "").slice(0, 80);
  const matchId = payloadMatchId || currentMatchId || `${room.code}-${Date.now()}`;
  let currentRound = clampServerNumber(currentGame?.round, 0, 100, 0);
  const round = clampServerNumber(command.payload.round || currentRound, 1, 100, currentRound || 1);
  const matchSettings = normalizeRoomGameSettings(command.payload.matchSettings || command.payload.settings || currentGame?.matchSettings || room.settings);
  const questionLanguage = normalizeQuestionLanguage(
    command.payload.questionLanguage
      || command.payload.language
      || command.payload.matchSettings?.questionLanguage
      || command.payload.settings?.questionLanguage
      || room.settings?.questionLanguage
      || matchSettings.questionLanguage
  );
  matchSettings.questionLanguage = questionLanguage;
  const activeMatchInProgress = room.status === "in-progress" && currentGame && currentGame.status !== "ended";

  if (activeMatchInProgress && currentMatchId && payloadMatchId && payloadMatchId !== currentMatchId) {
    sendJson(res, 409, { ok: false, error: "Round setup belongs to a previous match." });
    return;
  }
  if (activeMatchInProgress && currentRound && round < currentRound) {
    sendJson(res, 409, { ok: false, error: "Round setup belongs to a previous round." });
    return;
  }
  if (activeMatchInProgress && currentRound && round > currentRound) {
    sendJson(res, 409, { ok: false, error: "Round setup cannot skip the prepared round." });
    return;
  }
  if (activeMatchInProgress && (currentGame.status === "grading" || currentGame.roundResult)) {
    sendJson(res, 409, { ok: false, error: "Round setup cannot overwrite a locked round." });
    return;
  }
  if (currentGame?.setup && currentGame.status !== "starting") {
    sendJson(res, 200, {
      ok: true,
      roomCode: room.code,
      revision: getRoomRevision(room),
      updatedAt: room.updatedAt,
      duplicate: true,
      game: currentGame,
      events: []
    });
    return;
  }
  if (room.status !== "in-progress" || !currentGame || currentGame.status !== "starting") {
    currentGame = applyRoomRoundPreparationState(room, {
      normalizedCode: room.code,
      currentGame,
      matchId,
      round,
      matchSettings,
      hostParticipantId: command.participantId,
      clientEventId: command.clientEventId
    });
    currentMatchId = String(currentGame?.matchId || "").slice(0, 80);
    currentRound = clampServerNumber(currentGame?.round, 0, 100, 0);
  }

  // Make the preparing state visible while the shared question is generated.
  // The final command response below repeats the ordered events, which also
  // covers clients that missed this first realtime publish.
  finalizeRoom(room);
  const preparingRoom = await backendStore.upsertRoom(room);
  const preparationRevision = getRoomRevision(preparingRoom);
  const preparationBroadcast = await scheduleServerRoomRealtimeBroadcast(
    preparingRoom.code,
    getRoomEventsAfterRevision(preparingRoom, previousRevision, { includeSubmittedAnswers: true }),
    { includeSubmittedAnswers: true }
  );

  const enabledThemes = normalizeEnabledThemes(command.payload.enabledThemes || matchSettings.enabledThemes || room.settings?.enabledThemes);
  const preferredTheme = normalizePreferredTheme(command.payload.preferredTheme, enabledThemes);
  const recentBlackCards = Array.isArray(command.payload.recentBlackCards) ? command.payload.recentBlackCards.map(String).slice(-30) : [];
  const totalRounds = clampServerNumber(command.payload.totalRounds || matchSettings.rounds || room.settings?.rounds, 1, 100, matchSettings.rounds || 10);
  const setupSeed = String(command.payload.setupSeed || `${Date.now()}-${Math.random()}`).slice(0, 80);
  let setup;
  try {
    setup = await getSeedQuestionSetup({
      recentBlackCards,
      enabledThemes,
      preferredTheme,
      questionLanguage,
      setupSeed,
      backgroundMode: false,
      round,
      totalRounds
    });
  } catch {
    const recovery = restoreRoomAfterRoundSetupFailure(room, stableRoomBeforePreparation, command);
    const storedRoom = await backendStore.upsertRoom(recovery.room);
    sendJson(res, 409, {
      ...(await createRoomCommandResponse(storedRoom, previousRevision, {
        includeSubmittedAnswers: true,
        broadcastSinceRevision: preparationBroadcast ? preparationRevision : previousRevision
      })),
      ok: false,
      recovery: true,
      error: recovery.message,
      game: storedRoom.game || null
    });
    return;
  }
  if (!setup) {
    const recovery = restoreRoomAfterRoundSetupFailure(room, stableRoomBeforePreparation, command);
    const storedRoom = await backendStore.upsertRoom(recovery.room);
    sendJson(res, 409, {
      ...(await createRoomCommandResponse(storedRoom, previousRevision, {
        includeSubmittedAnswers: true,
        broadcastSinceRevision: preparationBroadcast ? preparationRevision : previousRevision
      })),
      ok: false,
      recovery: true,
      error: recovery.message,
      game: storedRoom.game || null
    });
    return;
  }

  const now = Date.now();
  const timerState = createRoomTimerState(room, matchSettings, now);
  room.participants = room.participants.map((participant) => {
    if (!isGameplayParticipant(participant)) {
      return participant;
    }
    const role = normalizeParticipantRole(participant);
    return {
      ...participant,
      status: "playing",
      answer: "",
      answerDraft: "",
      currentAnswer: "",
      submittedRound: 0,
      submissionMatchId: "",
      remainingTime: 0,
      submittedAt: 0,
      usedHintRound: 0,
      role,
      host: role === "host",
      bot: role === "bot",
      spectator: false
    };
  });
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
    powerState: command.payload.powerState || currentGame?.powerState || null,
    setupStartedAt: currentGame?.setupStartedAt || now,
    roundStartedAt: now,
    baseDurationMs: timerState.baseDurationMs,
    participantTimers: timerState.participantTimers,
    gradingForceAt: timerState.gradingForceAt,
    updatedAt: now
  });
  stampRoomEvent(room, "round_started", {
    clientEventId: command.clientEventId,
    round,
    matchId,
    game: room.game
  });
  finalizeRoom(room);
  const storedRoom = await backendStore.upsertRoom(room);
  sendJson(res, 200, {
    ...(await createRoomCommandResponse(storedRoom, previousRevision, {
      includeSubmittedAnswers: true,
      broadcastSinceRevision: preparationRevision
    })),
    game: storedRoom.game || room.game
  });
}

async function handleRoomCommandUpdateSettings(req, res, room, command, rawBody = {}) {
  if (!requireRoomHostAuth(req, res, room, rawBody, "Only the host can update room settings.")) {
    return;
  }
  const previousRevision = getRoomRevision(room);
  const nextSettings = normalizeRoomSettings({
    ...(room.settings || {}),
    ...(command.payload.settings && typeof command.payload.settings === "object" ? command.payload.settings : command.payload)
  }, room.code);
  const nextStatus = ["draft", "lobby", "in-progress", "complete"].includes(command.payload.status)
    ? command.payload.status
    : room.status;
  room.settings = nextSettings;
  room.status = nextStatus;
  if (command.payload.host && typeof command.payload.host === "object") {
    room.host = {
      ...(room.host || {}),
      id: String(command.payload.host.id || room.host?.id || "host").slice(0, 80),
      profileUserId: String(command.payload.host.profileUserId || room.host?.profileUserId || command.payload.host.userId || room.host?.id || "host").slice(0, 140),
      name: String(command.payload.host.name || room.host?.name || "Host").slice(0, 24),
      avatar: String(command.payload.host.avatar || room.host?.avatar || "").slice(0, 60000),
      equippedTitleId: String(command.payload.host.equippedTitleId || room.host?.equippedTitleId || "").slice(0, 80),
      specialBadges: normalizeSpecialBadges(command.payload.host.specialBadges || room.host?.specialBadges),
      cardCustomization: normalizeCardCustomization(command.payload.host.cardCustomization || room.host?.cardCustomization)
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
      hostParticipant.role = "host";
    }
  }
  finalizeRoom(room);
  stampRoomEvent(room, "settings_updated", {
    clientEventId: command.clientEventId,
    actorId: command.participantId,
    status: room.status,
    settingsEditSeq: clampServerNumber(command.payload.settingsEditSeq, 0, Number.MAX_SAFE_INTEGER, 0),
    settings: sanitizeRoomSettingsForClient(room.settings),
    host: room.host
  });
  const storedRoom = await backendStore.upsertRoom(room);
  sendJson(res, 200, await createRoomCommandResponse(storedRoom, previousRevision));
}

async function handleRoomCommandModerateParticipant(req, res, room, command, rawBody = {}) {
  if (!requireRoomHostAuth(req, res, room, rawBody, "Only the host can moderate this room.")) {
    return;
  }
  const previousRevision = getRoomRevision(room);
  const action = String(command.payload.action || "").slice(0, 32);
  const participantId = String(command.payload.targetParticipantId || command.payload.participantId || "").slice(0, 80);
  const participant = room.participants.find((entry) => entry.id === participantId);
  if (!participant || normalizeParticipantRole(participant) === "host" || participant.id === room.host?.id) {
    sendJson(res, 404, { ok: false, error: "Participant not found." });
    return;
  }

  if (action === "mute" || action === "unmute" || action === "set-muted") {
    const muted = action === "mute" ? true : action === "unmute" ? false : Boolean(command.payload.muted);
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
    sendJson(res, 400, { ok: false, error: "Unknown moderation action." });
    return;
  }

  finalizeRoom(room);
  stampRoomEvent(room, "participant_moderated", {
    clientEventId: command.clientEventId,
    actorId: command.participantId,
    action,
    participantId,
    muted: Boolean(participant.muted),
    banned: room.banned || [],
    participant: sanitizeParticipantForClient(participant),
    reason: String(command.payload.reason || "").slice(0, 80)
  });
  if (!hasActiveRealPlayers(room)) {
    await closeStoredRoom(room.code, "empty-room", room);
    sendJson(res, 200, {
      ok: true,
      closed: true,
      roomCode: room.code,
      revision: getRoomRevision(room),
      reason: "empty-room",
      events: []
    });
    return;
  }
  const storedRoom = await backendStore.upsertRoom(room);
  sendJson(res, 200, await createRoomCommandResponse(storedRoom, previousRevision));
}

async function handleRoomCommandTransferHost(req, res, room, command, rawBody = {}) {
  if (!requireRoomHostAuth(req, res, room, rawBody, "Only the host can transfer this room.")) {
    return;
  }
  const previousRevision = getRoomRevision(room);
  const promotedRoom = transferRoomHostToOldestPlayer(room, command.payload.reason || "host-transfer");
  if (!promotedRoom) {
    sendJson(res, 409, {
      ok: false,
      roomCode: room.code,
      revision: getRoomRevision(room),
      error: "No active player is available to become host.",
      events: []
    });
    return;
  }
  const storedRoom = await backendStore.upsertRoom(promotedRoom);
  sendJson(res, 200, {
    ...(await createRoomCommandResponse(storedRoom, previousRevision)),
    room: sanitizeRoomForClient(storedRoom, { includePrivateSecrets: true })
  }, { "Set-Cookie": createRoomHostCookie(req, storedRoom) });
}

async function handleRoomCommandMoveToGrading(req, res, room, command, rawBody = {}) {
  const isTimerExpired = command.type === "resolve_timer_expired"
    || normalizeRoomGradingReason(command.payload.reason) === "timer-expired";
  if (isTimerExpired) {
    if (!requireRoomParticipantAuth(req, res, room, command.participantId, rawBody, "Only a room participant can resolve an expired timer.")) {
      return;
    }
  } else if (!requireRoomHostAuth(req, res, room, rawBody, "Only the host can skip to grading.")) {
    return;
  }

  const game = room.game && typeof room.game === "object" ? room.game : null;
  const currentMatchId = String(game?.matchId || "").slice(0, 80);
  const payloadMatchId = String(command.payload.matchId || "").slice(0, 80);
  if (payloadMatchId && currentMatchId && payloadMatchId !== currentMatchId) {
    sendJson(res, 409, { ok: false, error: "Grading request belongs to a previous match." });
    return;
  }
  const currentRound = clampServerNumber(game?.round, 0, 100, 0);
  const round = clampServerNumber(command.payload.round, 1, 100, currentRound || 1);
  if (currentRound && round !== currentRound) {
    sendJson(res, 409, { ok: false, error: "Grading request belongs to a different round." });
    return;
  }
  if (isTimerExpired) {
    const now = Date.now();
    const gradingForceAt = clampServerNumber(game?.gradingForceAt || command.payload.gradingForceAt, 0, Number.MAX_SAFE_INTEGER, 0);
    if (gradingForceAt && now < gradingForceAt) {
      sendJson(res, 409, { ok: false, error: "Timer has not expired yet." });
      return;
    }
  }

  const previousRevision = getRoomRevision(room);
  const transition = startRoomGradingTransition(room, {
    force: isTimerExpired || Boolean(command.payload.force),
    reason: isTimerExpired ? "timer-expired" : command.payload.reason || "host-skip",
    hostParticipantId: String(command.payload.hostParticipantId || command.participantId || "").slice(0, 80),
    matchId: currentMatchId || payloadMatchId,
    round,
    submissions: command.payload.submissions,
    gradingForceAt: command.payload.gradingForceAt,
    clientEventId: command.clientEventId
  });
  if (!transition.started && !transition.duplicate) {
    sendJson(res, 409, {
      ok: false,
      error: "Round still has pending answers.",
      pendingParticipantIds: transition.pendingParticipantIds
    });
    return;
  }
  finalizeRoom(room);
  const storedRoom = await backendStore.upsertRoom(room);
  sendJson(res, 200, await createRoomCommandResponse(storedRoom, previousRevision, {
    includeSubmittedAnswers: true
  }));
}

async function handleRoomCommandPublishRoundResult(req, res, room, command, rawBody = {}) {
  if (!requireRoomHostAuth(req, res, room, rawBody, "Only the host can publish round results.")) {
    return;
  }
  const roundResult = normalizeRoomRoundResult(command.payload.roundResult || command.payload);
  if (!roundResult) {
    sendJson(res, 400, { ok: false, error: "Round result payload is incomplete." });
    return;
  }
  const currentMatchId = String(room.game?.matchId || "").slice(0, 80);
  if (roundResult.matchId && currentMatchId && roundResult.matchId !== currentMatchId) {
    sendJson(res, 409, { ok: false, error: "Round result belongs to a previous match." });
    return;
  }
  const currentRound = clampServerNumber(room.game?.round, 0, 100, 0);
  if (roundResult.round && currentRound && roundResult.round !== currentRound) {
    sendJson(res, 409, { ok: false, error: "Round result belongs to a different round." });
    return;
  }
  if (!roundResult.matchId && currentMatchId) {
    roundResult.matchId = currentMatchId;
  }
  if (room.game?.status !== "grading" && !room.game?.roundResult) {
    sendJson(res, 409, { ok: false, error: "Round must be locked for grading before publishing results." });
    return;
  }

  const previousRevision = getRoomRevision(room);
  const existingResult = normalizeRoomRoundResult(room.game?.roundResult || null);
  if (
    existingResult
    && (!existingResult.matchId || !roundResult.matchId || existingResult.matchId === roundResult.matchId)
    && Number(existingResult.round) === Number(roundResult.round || currentRound)
  ) {
    const response = await createRoomCommandResponse(room, previousRevision, { includeSubmittedAnswers: true });
    // The result is immutable for a match/round, but its realtime delivery is
    // not. A host retry can reach this duplicate branch after the original
    // publish was committed while a joined client missed the broadcast. Send
    // the canonical persisted event again so the joined client receives the
    // same authoritative hand-off instead of waiting for a later snapshot.
    const canonicalEvent = getCanonicalRoomRoundResultEvent(room, existingResult, {
      includeSubmittedAnswers: true
    });
    if (canonicalEvent && !response.events.some((event) => event.id === canonicalEvent.id)) {
      response.events = [...response.events, canonicalEvent];
      const [serverBroadcast, resultReadyBroadcast] = await Promise.all([
        scheduleServerRoomRealtimeBroadcast(room.code, [canonicalEvent], { includeSubmittedAnswers: true }),
        broadcastRoomRoundResultReady(room, canonicalEvent)
      ]);
      response.serverBroadcast = serverBroadcast;
      response.resultReadyBroadcast = resultReadyBroadcast;
    } else if (!canonicalEvent && !response.events.some((event) => event.type === "round_result")) {
      // Older rooms may contain the stored result without its event log entry.
      // Reconstruct a same-revision recovery event from the authoritative room
      // state so those rooms can still release joined clients from grading.
      const recoveryEvent = createSyntheticRoomEvent(room, "round_result", {
        clientEventId: command.clientEventId,
        actorId: command.participantId,
        round: existingResult.round,
        matchId: room.game?.matchId || existingResult.matchId || "",
        roundResult: existingResult,
        game: room.game
      });
      response.events = [...response.events, recoveryEvent];
      const [serverBroadcast, resultReadyBroadcast] = await Promise.all([
        scheduleServerRoomRealtimeBroadcast(room.code, [recoveryEvent], { includeSubmittedAnswers: true }),
        broadcastRoomRoundResultReady(room, recoveryEvent)
      ]);
      response.serverBroadcast = serverBroadcast;
      response.resultReadyBroadcast = resultReadyBroadcast;
    }
    sendJson(res, 200, {
      ...response,
      duplicate: true,
      roundResult: existingResult,
      game: room.game
    });
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
    clientEventId: command.clientEventId,
    actorId: command.participantId,
    round: roundResult.round,
    matchId: room.game?.matchId || "",
    roundResult,
    game: room.game
  });
  finalizeRoom(room);
  const storedRoom = await backendStore.upsertRoom(room);
  sendJson(res, 200, await createRoomCommandResponse(storedRoom, previousRevision, {
    includeSubmittedAnswers: true
  }));
}

async function handleRoomCommandEndGame(req, res, room, command, rawBody = {}) {
  if (!requireRoomHostAuth(req, res, room, rawBody, "Only the host can end this game.")) {
    return;
  }
  const payloadGame = command.payload.game && typeof command.payload.game === "object"
    ? command.payload.game
    : command.payload && typeof command.payload === "object"
      ? command.payload
      : {};
  const currentGame = room.game && typeof room.game === "object" ? room.game : {};
  const game = normalizeRoomGame({
    ...currentGame,
    ...(payloadGame && typeof payloadGame === "object" ? payloadGame : {}),
    matchId: payloadGame.matchId || currentGame.matchId || `${room.code}-${Date.now()}`,
    status: "ended",
    round: clampServerNumber(payloadGame.round || currentGame.round, 1, 100, currentGame.round || 1),
    setup: payloadGame.setup || currentGame.setup || null,
    powerState: payloadGame.powerState || currentGame.powerState || null,
    updatedAt: Date.now()
  });
  const currentMatchId = String(currentGame.matchId || "").slice(0, 80);
  if (currentMatchId && game.matchId && game.matchId !== currentMatchId) {
    sendJson(res, 409, { ok: false, error: "Game end belongs to a previous match." });
    return;
  }
  const currentRound = clampServerNumber(currentGame.round, 0, 100, 0);
  if (currentRound && game.round < currentRound) {
    sendJson(res, 409, { ok: false, error: "Game end belongs to a previous round." });
    return;
  }

  const previousRevision = getRoomRevision(room);
  room.status = "complete";
  room.game = game;
  stampRoomEvent(room, "game_ended", {
    clientEventId: command.clientEventId,
    actorId: command.participantId,
    round: game.round,
    matchId: game.matchId,
    game
  });
  finalizeRoom(room);
  const storedRoom = await backendStore.upsertRoom(room);
  sendJson(res, 200, {
    ...(await createRoomCommandResponse(storedRoom, previousRevision, { includeSubmittedAnswers: true })),
    game: storedRoom.game || game
  });
}

async function handleRoomCommandReturnToLobby(req, res, room, command, rawBody = {}) {
  if (!requireRoomHostAuth(req, res, room, rawBody, "Only the host can return the room to lobby.")) {
    return;
  }

  const currentMatchId = String(room.game?.matchId || "").slice(0, 80);
  const payloadMatchId = String(command.payload.matchId || command.payload.game?.matchId || "").slice(0, 80);
  if (currentMatchId && payloadMatchId && payloadMatchId !== currentMatchId) {
    sendJson(res, 409, { ok: false, error: "Lobby return belongs to a previous match." });
    return;
  }

  const previousRevision = getRoomRevision(room);
  room.status = "lobby";
  room.game = null;
  room.participants = (Array.isArray(room.participants) ? room.participants : [])
    .map(clearParticipantMatchState)
    .map(normalizeParticipant);
  room.hostExitPendingAt = 0;
  finalizeRoom(room);
  const lobbySnapshot = sanitizeRoomForClient({ ...room, events: [] }, { includePrivateSecrets: true });
  stampRoomEvent(room, "room_updated", {
    clientEventId: command.clientEventId,
    actorId: command.participantId,
    status: "lobby",
    previousMatchId: currentMatchId,
    room: lobbySnapshot,
    game: null
  });
  const storedRoom = await backendStore.upsertRoom(room);
  sendJson(res, 200, {
    ...(await createRoomCommandResponse(storedRoom, previousRevision)),
    room: sanitizeRoomForClient(storedRoom, { includePrivateSecrets: true })
  });
}

async function handleRoomCommandSendChat(req, res, room, command, rawBody = {}) {
  const participantId = command.participantId;
  if (!participantId) {
    sendJson(res, 400, { ok: false, error: "Missing participant id." });
    return;
  }
  if (!requireRoomParticipantAuth(req, res, room, participantId, rawBody, "Only room participants can send chat messages.")) {
    return;
  }
  const participant = room.participants.find((entry) => entry.id === participantId);
  if (!participant || participant.active === false) {
    sendJson(res, 404, { ok: false, error: "Participant is not active in this room." });
    return;
  }
  if (participant.muted) {
    sendJson(res, 403, { ok: false, error: "You are muted in this room." });
    return;
  }

  const rawMessage = command.payload.message && typeof command.payload.message === "object"
    ? command.payload.message
    : command.payload;
  const createdAt = Date.now();
  const message = normalizeRoomChat([{
    id: rawMessage.id || `chat-${participantId}-${createdAt}`,
    sender: participant.name || "Player",
    avatar: participant.avatar || "",
    equippedTitleId: participant.equippedTitleId || "",
    specialBadges: participant.specialBadges || [],
    cardCustomization: participant.cardCustomization || null,
    text: rawMessage.text || "",
    owner: participantId,
    participantId,
    host: Boolean(participant.host),
    spectator: Boolean(participant.spectator),
    createdAt
  }])[0] || null;
  if (!message) {
    sendJson(res, 400, { ok: false, error: "Chat message is empty." });
    return;
  }

  const previousRevision = getRoomRevision(room);
  room.chat = normalizeRoomChat([...normalizeRoomChat(room.chat), message]);
  participant.lastSeenAt = createdAt;
  stampRoomEvent(room, "chat_message", {
    clientEventId: command.clientEventId,
    actorId: participantId,
    participantId,
    message
  });
  finalizeRoom(room);
  const storedRoom = await backendStore.upsertRoom(room);
  sendJson(res, 200, {
    ...(await createRoomCommandResponse(storedRoom, previousRevision)),
    message
  });
}

async function handleRoomCommandUsePower(req, res, room, command, rawBody = {}) {
  const body = command.payload && typeof command.payload === "object" ? command.payload : {};
  const actorParticipantId = String(body.actorParticipantId || command.participantId || "").slice(0, 120);
  const powerAuthMode = getRoomPowerAuthMode();
  const action = body.action && typeof body.action === "object"
    ? normalizeRoomPowerAction(body.action, body)
    : null;
  if (!action && powerAuthMode === "enforce") {
    sendJson(res, 400, {
      ok: false,
      error: "Power use needs an action intent. Please refresh before using a power."
    });
    return;
  }
  const requestHasHostAuth = hasRoomHostAuth(req, room, rawBody);
  if (!requestHasHostAuth) {
    if (!actorParticipantId) {
      sendJson(res, 400, { ok: false, error: "Missing actor participant id." });
      return;
    }
    if (!requireRoomParticipantAuth(req, res, room, actorParticipantId, rawBody, "Only the acting participant can update power state.")) {
      return;
    }
    const actorParticipant = room.participants.find((participant) => participant.id === actorParticipantId);
    if (!actorParticipant || !isGameplayParticipant(actorParticipant)) {
      sendJson(res, 403, { ok: false, error: "Spectators cannot update power state." });
      return;
    }
  }

  const currentMatchId = String(room.game?.matchId || "").slice(0, 80);
  const bodyPowerId = String(body.powerId || "").trim().slice(0, 80);
  if (action && bodyPowerId && bodyPowerId !== action.powerId) {
    sendJson(res, 400, { ok: false, error: "Power action does not match the requested power." });
    return;
  }
  const payloadMatchId = String(action?.matchId || body.matchId || body.powerState?.matchId || "").slice(0, 80);
  if (payloadMatchId && currentMatchId && payloadMatchId !== currentMatchId) {
    sendJson(res, 409, { ok: false, error: "Power state belongs to a previous match." });
    return;
  }
  const currentRound = clampServerNumber(room.game?.round, 0, 100, 0);
  const payloadRound = clampServerNumber(action?.round || body.round || body.powerState?.round, 0, 100, 0);
  if (payloadRound && currentRound && payloadRound !== currentRound) {
    sendJson(res, 409, { ok: false, error: "Power state belongs to a different round." });
    return;
  }

  const previousRevision = getRoomRevision(room);
  const previousPowerState = normalizeRoomPowerState(room.game?.powerState);
  if (action) {
    const actionValidationError = validateRoomPowerActionIntent(room, previousPowerState, action, actorParticipantId);
    if (actionValidationError) {
      sendJson(res, actionValidationError.status || 409, {
        ok: false,
        error: actionValidationError.error || "Power use failed server validation.",
        powerId: actionValidationError.powerId || action.powerId
      });
      return;
    }
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
    sendJson(res, 400, { ok: false, error: "Room power update needs a power state payload." });
    return;
  }

  const validationError = action
    ? null
    : validateRoomPowerUseAuthority(room, previousPowerState, powerState, body, actorParticipantId);
  if (validationError) {
    sendJson(res, validationError.status || 409, {
      ok: false,
      error: validationError.error || "Power use failed server validation.",
      powerId: validationError.powerId || String(body.powerId || "").slice(0, 80)
    });
    return;
  }
  const serverActionPowerState = action?.type === "use"
    ? applyServerPowerAction(previousPowerState, action, command.clientEventId)
    : null;
  let actionPowerState = powerState;
  if (action?.type === "use" && serverActionPowerState) {
    actionPowerState = isServerPowerEngineMigrated(action.powerId)
      ? serverActionPowerState
      : overlayServerPowerActionState(powerState, serverActionPowerState, actorParticipantId);
  }
  const mergedPowerState = stampRoomPowerStateServerRevision(
    previousPowerState,
    actionPowerState,
    mergeRoomPowerState(previousPowerState, actionPowerState),
    getRoomPowerStateRevision(previousPowerState) + 1
  );
  if (!room.game || typeof room.game !== "object") {
    room.game = {
      matchId: payloadMatchId || `${room.code}-${Date.now()}`,
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
  const timerState = applyRoomTimerAction(
    room,
    action?.type === "use" && action?.powerId === "time_bender"
      ? {
        ...body,
        powerId: "time_bender",
        timerAction: {
          type: "time_bender",
          multiplier: clampServerNumber(action.meta?.timerMultiplier, 2, 4, 2)
        },
        actorParticipantId
      }
      : body
  );
  const powerEventPayload = {
    clientEventId: command.clientEventId,
    actorId: actorParticipantId,
    round: clampServerNumber(body.round, 0, 100, room.game.round || 0),
    powerId: String(action?.powerId || body.powerId || "").slice(0, 80),
    actorParticipantId,
    targetParticipantId: String(action?.targetParticipantId || body.targetParticipantId || "").slice(0, 120),
    targetParticipantIds: action?.targetParticipantIds || [],
    deletedPowerId: String(body.deletedPowerId || "").slice(0, 80),
    stolenPowerId: String(body.stolenPowerId || "").slice(0, 80),
    matchId: room.game?.matchId || powerState.matchId || "",
    powerState: mergedPowerState,
    timerState,
    action: action || null,
    serverAuthoritative: Boolean(action?.type === "use" && isServerPowerEngineMigrated(action.powerId))
  };
  // A power action is one authoritative state transition. Emitting the same
  // full effect map under several event types bloated the room stream and
  // could delay the grading event that immediately followed a power use.
  stampRoomEvent(room, "power_state", powerEventPayload);
  finalizeRoom(room);
  const storedRoom = await backendStore.upsertRoom(room);
  const responsePowerState = normalizeRoomPowerState(storedRoom.game?.powerState) || mergedPowerState;
  sendJson(res, 200, {
    ...(await createRoomCommandResponse(storedRoom, previousRevision)),
    round: clampServerNumber(body.round, 0, 100, storedRoom.game?.round || 0),
    matchId: storedRoom.game?.matchId || responsePowerState.matchId || "",
    powerId: String(action?.powerId || body.powerId || "").slice(0, 80),
    actorParticipantId,
    targetParticipantId: String(action?.targetParticipantId || body.targetParticipantId || "").slice(0, 120),
    targetParticipantIds: action?.targetParticipantIds || [],
    deletedPowerId: String(body.deletedPowerId || "").slice(0, 80),
    stolenPowerId: String(body.stolenPowerId || "").slice(0, 80),
    action: action || null,
    serverAuthoritative: Boolean(action?.type === "use" && isServerPowerEngineMigrated(action.powerId)),
    powerState: responsePowerState,
    powerRevision: responsePowerState.revision || 0,
    hands: responsePowerState.hands,
    played: responsePowerState.played,
    players: responsePowerState.players,
    effects: responsePowerState.effects,
    timerState: getRoomTimerStatePayload(storedRoom.game) || timerState
  });
}

async function handleRoomCommandLeaveRoom(req, res, room, command, rawBody = {}) {
  const participantId = command.participantId;
  if (!participantId) {
    sendJson(res, 400, { ok: false, error: "Missing participant id." });
    return;
  }
  const reason = String(command.payload.reason || "manual").slice(0, 40);
  const isHostLeaving = isHostParticipant(room, participantId);
  if (isHostLeaving) {
    if (!requireRoomHostAuth(req, res, room, rawBody, "Only the host can close this room.")) {
      return;
    }
    const previousRevision = getRoomRevision(room);
    const promotedRoom = transferRoomHostToOldestPlayer(room, "host-left");
    if (promotedRoom) {
      const storedRoom = await backendStore.upsertRoom(promotedRoom);
      sendJson(res, 200, {
        ...(await createRoomCommandResponse(storedRoom, previousRevision)),
        room: sanitizeRoomForClient(storedRoom, { includePrivateSecrets: true })
      }, { "Set-Cookie": createRoomHostCookie(req, storedRoom) });
      return;
    }
    await closeStoredRoom(room.code, "host-left", room);
    sendJson(res, 200, {
      ok: true,
      closed: true,
      roomCode: room.code,
      revision: getRoomRevision(room),
      reason: "host-left",
      events: []
    });
    return;
  }
  if (!requireRoomParticipantAuth(req, res, room, participantId, rawBody, "Only this participant can leave the room.")) {
    return;
  }

  const previousRevision = getRoomRevision(room);
  const leavingParticipant = room.participants.find((participant) => participant.id === participantId) || null;
  room.participants = room.participants.filter((participant) => participant.id !== participantId);
  finalizeRoom(room);
  if (!hasActiveRealPlayers(room)) {
    await closeStoredRoom(room.code, "empty-room", room);
    sendJson(res, 200, {
      ok: true,
      closed: true,
      roomCode: room.code,
      revision: getRoomRevision(room),
      reason: "empty-room",
      events: []
    });
    return;
  }

  stampRoomEvent(room, "participant_left", {
    clientEventId: command.clientEventId,
    actorId: participantId,
    participantId,
    participantName: leavingParticipant?.name || "A player",
    participant: sanitizeParticipantForClient(leavingParticipant || { id: participantId, name: "A player" }),
    reason
  });
  const storedRoom = await backendStore.upsertRoom(room);
  sendJson(res, 200, await createRoomCommandResponse(storedRoom, previousRevision));
}

async function handleRoomCommandParticipantPresence(req, res, room, command, rawBody = {}, options = {}) {
  const activeRoom = await ensureRoomReconnectGrace(room);
  if (!activeRoom) {
    const close = await backendStore.getRoomClose(room.code);
    sendJson(res, 410, {
      ok: false,
      closed: true,
      roomCode: room.code,
      close: close || createRoomClosePayload(room.code, "host-disconnected"),
      events: []
    });
    return;
  }

  const payload = command.payload && typeof command.payload === "object" ? command.payload : {};
  const body = {
    ...(rawBody && typeof rawBody === "object" ? rawBody : {}),
    ...payload,
    clientEventId: command.clientEventId
  };
  const rawParticipant = payload.participant && typeof payload.participant === "object"
    ? payload.participant
    : body.participant && typeof body.participant === "object"
      ? body.participant
      : {};
  const participantPatch = {
    ...rawParticipant,
    id: rawParticipant.id || command.participantId,
    tabSessionId: rawParticipant.tabSessionId || command.tabSessionId,
    active: Object.hasOwn(options, "active") ? Boolean(options.active) : rawParticipant.active !== false
  };
  if (!participantPatch.status && options.defaultStatus) {
    participantPatch.status = options.defaultStatus;
  }

  let participant;
  try {
    participant = normalizeParticipant(participantPatch);
  } catch (error) {
    sendJson(res, 400, { ok: false, error: error.message || "Missing participant id." });
    return;
  }

  const previousRevision = getRoomRevision(activeRoom);
  let existingIndex = activeRoom.participants.findIndex((entry) => entry.id === participant.id);
  const sameProfileIndex = participant.profileUserId && normalizeParticipantRole(participant) !== "bot"
    ? activeRoom.participants.findIndex((entry) => (
      entry.id !== participant.id
      && normalizeParticipantRole(entry) !== "bot"
      && String(entry.profileUserId || "") === participant.profileUserId
    ))
    : -1;
  const sameProfileParticipant = sameProfileIndex >= 0 ? activeRoom.participants[sameProfileIndex] : null;
  if (
    sameProfileParticipant
    && sameProfileParticipant.active !== false
    && participant.active !== false
  ) {
    sendJson(res, 409, {
      ok: false,
      error: "This profile is already in the room.",
      duplicateParticipantId: sameProfileParticipant.id,
      roomCode: activeRoom.code,
      revision: getRoomRevision(activeRoom),
      events: []
    });
    return;
  }
  const reclaimingInactiveProfile = existingIndex < 0 && sameProfileParticipant?.active === false && participant.active !== false;
  if (reclaimingInactiveProfile) {
    existingIndex = sameProfileIndex;
  }

  const hostAuthenticated = hasRoomHostAuth(req, activeRoom, body);
  if (reclaimingInactiveProfile && normalizeParticipantRole(sameProfileParticipant) === "host" && (normalizeParticipantRole(participant) !== "host" || !hostAuthenticated)) {
    sendJson(res, 403, { ok: false, error: "Only the host can reclaim the host slot." });
    return;
  }
  const existingParticipantForAuth = existingIndex >= 0 ? activeRoom.participants[existingIndex] : null;
  const reclaimingKickedParticipant = Boolean(
    existingParticipantForAuth
    && existingParticipantForAuth.active === false
    && String(existingParticipantForAuth.status || "") === "kicked"
    && participant.active !== false
    && normalizeParticipantRole(existingParticipantForAuth) === "player"
    && String(existingParticipantForAuth.profileUserId || "") === String(participant.profileUserId || "")
  );
  const isHostIdentity = participant.id === activeRoom.host?.id || normalizeParticipantRole(participant) === "host";
  if (isHostIdentity && !hostAuthenticated) {
    sendJson(res, 403, { ok: false, error: "Only the host can update the host participant." });
    return;
  }
  if (normalizeParticipantRole(participant) === "bot" && !hostAuthenticated) {
    sendJson(res, 403, { ok: false, error: "Only the host can update bot participants." });
    return;
  }
  if (existingIndex >= 0 && !reclaimingInactiveProfile && !reclaimingKickedParticipant && !hostAuthenticated && !hasRoomParticipantAuth(req, activeRoom, participant.id, body)) {
    sendJson(res, 403, { ok: false, error: "Only this participant can update their room state." });
    return;
  }
  if (activeRoom.banned?.includes(participant.id) || activeRoom.banned?.includes(participant.name) || activeRoom.banned?.includes(participant.profileUserId)) {
    sendJson(res, 403, { ok: false, error: "This participant is banned from the room." });
    return;
  }
  if (activeRoom.settings?.private && existingIndex < 0 && !hostAuthenticated) {
    const password = String(body.password || body.roomPassword || "").trim();
    if (!secureEqual(password, activeRoom.settings.password || "")) {
      sendJson(res, 403, { ok: false, error: "Invalid room password." });
      return;
    }
  }
  if (existingIndex < 0 && isGameplayParticipant(participant)) {
    const activePlayers = activeRoom.participants.filter(isGameplayParticipant).length;
    if (activePlayers >= activeRoom.settings.maxPlayers) {
      sendJson(res, 409, { ok: false, error: "Room is full." });
      return;
    }
  }

  const currentMatchId = String(activeRoom.game?.matchId || "").slice(0, 80);
  const currentRound = clampServerNumber(activeRoom.game?.round, 0, 100, 0);
  const submissionMatchId = String(participant.submissionMatchId || "").slice(0, 80);
  const submissionRound = clampServerNumber(participant.submittedRound, 0, 100, 0);
  const hasSubmissionUpdate = Object.hasOwn(rawParticipant, "answer")
    || Object.hasOwn(rawParticipant, "submittedRound")
    || Object.hasOwn(rawParticipant, "remainingTime");
  const existingParticipant = existingIndex >= 0 ? activeRoom.participants[existingIndex] : null;
  const sameTabSessionRejoin = Boolean(
    command.type === "rejoin_room"
    && existingParticipant
    && existingParticipant.active !== false
    && participant.active !== false
    && existingParticipant.tabSessionId
    && participant.tabSessionId
    && existingParticipant.tabSessionId === participant.tabSessionId
  );
  const duplicateActiveConnection = Boolean(
    existingParticipant
    && existingParticipant.active !== false
    && participant.active !== false
    && existingParticipant.connectionId
    && participant.connectionId
    && existingParticipant.connectionId !== participant.connectionId
    && !sameTabSessionRejoin
    && !["disconnected", "host-disconnected", "spectator-disconnected"].includes(String(existingParticipant.status || ""))
  );
  if (duplicateActiveConnection) {
    sendJson(res, 409, {
      ok: false,
      error: "This participant is already active in another tab.",
      duplicateParticipantId: existingParticipant.id,
      roomCode: activeRoom.code,
      revision: getRoomRevision(activeRoom),
      events: []
    });
    return;
  }
  if (
    normalizeParticipantRole(existingParticipant) === "spectator"
    && activeRoom.status === "in-progress"
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
    sendJson(res, 403, { ok: false, error: "Spectators cannot submit gameplay answers." });
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
    sendJson(res, 200, {
      ok: true,
      roomCode: activeRoom.code,
      revision: getRoomRevision(activeRoom),
      updatedAt: activeRoom.updatedAt,
      duplicate: true,
      participant: sanitizeParticipantForClient(existingParticipantForAuth || existingParticipant, { includeSubmittedAnswers: true }),
      events: []
    });
    return;
  }

  if (existingIndex >= 0) {
    const nextRole = participant.role || normalizeParticipantRole(participant);
    const preserveReconnectGameplayStatus = Boolean(
      command.type === "rejoin_room"
      && isNowActive
      && !hasSubmissionUpdate
      && activeRoom.status === "in-progress"
      && ["player", "host"].includes(normalizeParticipantRole(existingParticipant))
    );
    const reconnectStatus = preserveReconnectGameplayStatus
      ? getRoomParticipantReconnectStatus(activeRoom, existingParticipant, participant.status)
      : "";
    const reconnectAnswerState = preserveReconnectGameplayStatus
      ? getRoomParticipantAnswerStateForCurrentRound(activeRoom, existingParticipant)
      : null;
    activeRoom.participants[existingIndex] = {
      ...existingParticipant,
      ...participant,
      role: nextRole,
      host: nextRole === "host",
      bot: nextRole === "bot",
      spectator: nextRole === "spectator",
      joinedAt: existingParticipant.joinedAt || participant.joinedAt || existingParticipant.lastConnectedAt || Date.now(),
      disconnectedAt: isNowActive ? 0 : Date.now(),
      lastConnectedAt: isNowActive ? Date.now() : existingParticipant.lastConnectedAt || 0,
      lastSeenAt: isNowActive ? Date.now() : existingParticipant.lastSeenAt || 0,
      status: preserveReconnectGameplayStatus
        ? reconnectStatus
        : hasSubmissionUpdate && !acceptsSubmissionUpdate ? existingParticipant.status : participant.status,
      answer: reconnectAnswerState
        ? reconnectAnswerState.answer
        : acceptsSubmissionUpdate && Object.hasOwn(rawParticipant, "answer") ? participant.answer : existingParticipant.answer,
      submittedRound: reconnectAnswerState
        ? reconnectAnswerState.round
        : acceptsSubmissionUpdate && Object.hasOwn(rawParticipant, "submittedRound") ? participant.submittedRound : existingParticipant.submittedRound,
      submissionMatchId: reconnectAnswerState
        ? reconnectAnswerState.matchId
        : acceptsSubmissionUpdate && Object.hasOwn(rawParticipant, "submittedRound") ? participant.submissionMatchId : existingParticipant.submissionMatchId || "",
      remainingTime: reconnectAnswerState
        ? reconnectAnswerState.remainingTime
        : acceptsSubmissionUpdate && Object.hasOwn(rawParticipant, "remainingTime") ? participant.remainingTime : existingParticipant.remainingTime,
      submittedAt: reconnectAnswerState
        ? reconnectAnswerState.submittedAt
        : existingParticipant.submittedAt
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
    participant.lastSeenAt = participant.active === false ? 0 : Date.now();
    participant.joinedAt = participant.joinedAt || Date.now();
    activeRoom.participants.push(participant);
  }

  if (normalizeParticipantRole(participant) === "host") {
    activeRoom.host = {
      ...(activeRoom.host || {}),
      id: participant.id,
      profileUserId: participant.profileUserId || participant.id,
      name: participant.name,
      avatar: participant.avatar,
      equippedTitleId: participant.equippedTitleId || "",
      specialBadges: normalizeSpecialBadges(participant.specialBadges),
      cardCustomization: participant.cardCustomization || null
    };
  }
  const storedParticipant = activeRoom.participants[existingIndex >= 0 ? existingIndex : activeRoom.participants.length - 1] || participant;
  if (storedParticipant.host || storedParticipant.id === activeRoom.host?.id) {
    activeRoom.hostExitPendingAt = storedParticipant.active === false ? Date.now() : 0;
  }
  if (normalizeParticipantRole(participant) !== "bot") {
    ensureRoomParticipantToken(activeRoom, participant.id);
  }
  finalizeRoom(activeRoom);
  const finalParticipant = activeRoom.participants.find((entry) => entry.id === participant.id) || storedParticipant || participant;
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
    clientEventId: command.clientEventId,
    actorId: finalParticipant.id,
    participantId: finalParticipant.id,
    participantName: finalParticipant.name || "A player",
    role: normalizeParticipantRole(finalParticipant),
    host: Boolean(finalParticipant.host),
    spectator: Boolean(finalParticipant.spectator),
    status: finalParticipant.status,
    participant: sanitizeParticipantForClient(finalParticipant, { includeSubmittedAnswers: true })
  };
  if (answerSubmitted) {
    eventPayload.matchId = String(finalParticipant.submissionMatchId || currentMatchId || "").slice(0, 80);
    eventPayload.round = clampServerNumber(finalParticipant.submittedRound, 1, 100, activeRoom.game?.round || 1);
    eventPayload.answer = String(finalParticipant.answer || "").slice(0, 500);
    eventPayload.remainingTime = clampServerNumber(finalParticipant.remainingTime, 0, 600, 0);
    autoSubmitRoomBotsWhenOnlyBotsPending(activeRoom, {
      matchId: eventPayload.matchId,
      round: eventPayload.round,
      clientEventId: command.clientEventId
    });
    eventPayload.submissionStatusSnapshot = getRoomSubmissionStatusSnapshot(
      activeRoom,
      eventPayload.matchId,
      eventPayload.round
    );
  }
  stampRoomEvent(activeRoom, eventType, eventPayload);
  if (answerSubmitted) {
    startRoomGradingTransition(activeRoom, {
      reason: "all-submitted",
      force: false,
      clientEventId: command.clientEventId
    });
  }
  const storedRoom = await backendStore.upsertRoom(activeRoom);
  const participantCookie = normalizeParticipantRole(participant) !== "bot" ? createRoomParticipantCookie(req, storedRoom, participant.id) : "";
  const response = {
    ...(await createRoomCommandResponse(storedRoom, previousRevision, { includeSubmittedAnswers: true })),
    participant: sanitizeParticipantForClient(
      storedRoom.participants.find((entry) => entry.id === participant.id) || finalParticipant,
      { includeSubmittedAnswers: true }
    )
  };
  if (body.includeRoom || body.includeRoomSnapshot) {
    response.room = sanitizeRoomForClient(storedRoom, { includePrivateSecrets: hostAuthenticated });
  }
  sendJson(res, 200, response, participantCookie ? { "Set-Cookie": participantCookie } : {});
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

async function closeStoredRoom(code, reason, sourceRoom = null) {
  const normalizedCode = String(code || "").trim().toUpperCase();
  if (!normalizedCode) {
    return false;
  }
  const storedRoom = sourceRoom && typeof sourceRoom === "object"
    ? sourceRoom
    : await backendStore.getRoom(normalizedCode);
  const close = createRoomClosePayload(normalizedCode, reason);
  if (storedRoom) {
    const previousRevision = getRoomRevision(storedRoom);
    storedRoom.status = "complete";
    storedRoom.closed = close;
    stampRoomEvent(storedRoom, "room_closed", {
      reason: close.reason,
      closedAt: close.closedAt
    });
    finalizeRoom(storedRoom);
    const persistedRoom = await backendStore.upsertRoom(storedRoom);
    await scheduleServerRoomRealtimeBroadcast(
      persistedRoom.code,
      getRoomEventsAfterRevision(persistedRoom, previousRevision, { includeSubmittedAnswers: false }),
      { includeSubmittedAnswers: false }
    );
  }
  await backendStore.upsertRoomClose(close);
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
      if (reason === "host-created-another-room" || reason === "host-left") {
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
  const transferRevision = getRoomRevision(room) + 1;
  const transferSnapshot = {
    ...sanitizeRoomForClient(
      { ...room, events: [] },
      { includeSubmittedAnswers: true }
    ),
    revision: transferRevision,
    updatedAt: Date.now()
  };
  stampRoomEvent(room, "host_transferred", {
    previousHostId: previousHost?.id || "",
    previousHostName: previousHost?.name || room.host?.name || "Host",
    newHostId: nextHost.id,
    newHostName: nextHost.name || "Host",
    reason: String(reason || "host-transfer").slice(0, 60),
    participant: nextHost,
    host: room.host,
    room: transferSnapshot
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
    const transfer = async () => {
      const latestRoom = await backendStore.getRoom(room?.code);
      if (!latestRoom || latestRoom.code === nextRoom.code || latestRoom.status === "complete" || getRoomOwnerKey(latestRoom) !== ownerKey) {
        return;
      }
      const activeRoom = await ensureRoomReconnectGrace(latestRoom, { skipHostTransfer: true });
      if (!activeRoom) {
        return;
      }
      const previousRevision = getRoomRevision(activeRoom);
      const promotedRoom = transferRoomHostToOldestPlayer(activeRoom, "host-created-another-room");
      if (!promotedRoom) {
        await closeStoredRoom(activeRoom.code, "host-created-another-room", activeRoom);
        return;
      }
      const storedRoom = await backendStore.upsertRoom(promotedRoom);
      await scheduleServerRoomRealtimeBroadcast(
        storedRoom.code,
        getRoomEventsAfterRevision(storedRoom, previousRevision, { includeSubmittedAnswers: true }),
        { includeSubmittedAnswers: true }
      );
      transferred.push(storedRoom);
    };
    if (room?.code && typeof backendStore.withRoomLock === "function") {
      await backendStore.withRoomLock(room.code, transfer);
    } else {
      await transfer();
    }
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

function getParticipantPresenceTimestamp(room = {}, participant = {}) {
  const joinedAt = normalizeServerTimestamp(participant.joinedAt, 0);
  const participantTimestamp = Math.max(
    normalizeServerTimestamp(participant.lastSeenAt, 0),
    normalizeServerTimestamp(participant.lastConnectedAt, 0),
    joinedAt > 1_000_000_000_000 ? joinedAt : 0
  );
  return participantTimestamp || normalizeServerTimestamp(room.updatedAt, 0);
}

function pruneStaleActiveParticipants(room, now = Date.now()) {
  if (!room || room.status === "complete" || !Array.isArray(room.participants)) {
    return [];
  }
  const disconnected = [];
  room.participants.forEach((participant) => {
    const role = normalizeParticipantRole(participant);
    if (
      role === "bot"
      || participant.active === false
      || participant.disconnectedAt
    ) {
      return;
    }
    const lastSeenAt = getParticipantPresenceTimestamp(room, participant);
    if (!lastSeenAt || now - lastSeenAt < participantActiveStaleMs) {
      return;
    }
    participant.active = false;
    participant.disconnectedAt = lastSeenAt;
    participant.status = role === "host"
      ? "host-disconnected"
      : role === "spectator"
        ? "spectator-disconnected"
        : "disconnected";
    disconnected.push(participant);
  });
  disconnected.forEach((participant) => {
    stampRoomEvent(room, "participant_disconnected", {
      participantId: participant.id,
      participantName: participant.name || "A player",
      participant,
      reason: "stale-presence"
    });
  });
  return disconnected;
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

function isEmptyRoomCloseGraceExpired(room, now = Date.now()) {
  if (!room || room.status === "complete" || hasActiveRealPlayers(room)) {
    return false;
  }
  const presenceTimes = (Array.isArray(room.participants) ? room.participants : [])
    .filter((participant) => normalizeParticipantRole(participant) !== "bot")
    .map((participant) => Math.max(
      normalizeServerTimestamp(participant.disconnectedAt, 0),
      getParticipantPresenceTimestamp(room, participant)
    ))
    .filter(Boolean);
  const lastPresenceAt = presenceTimes.length
    ? Math.max(...presenceTimes)
    : normalizeServerTimestamp(room.updatedAt, 0);
  return Boolean(lastPresenceAt && now - lastPresenceAt >= emptyRoomCloseGraceMs);
}

async function ensureRoomReconnectGrace(room, options = {}) {
  const previousRevision = getRoomRevision(room);
  const staleParticipants = pruneStaleActiveParticipants(room);
  if (isEmptyRoomCloseGraceExpired(room)) {
    await closeStoredRoom(room.code, "empty-room", room);
    return null;
  }
  if (!isRoomHostReconnectGraceExpired(room)) {
    const removed = pruneExpiredDisconnectedParticipants(room);
    if (staleParticipants.length || removed.length) {
      finalizeRoom(room);
      if (isEmptyRoomCloseGraceExpired(room)) {
        await closeStoredRoom(room.code, "empty-room", room);
        return null;
      }
      const storedRoom = await backendStore.upsertRoom(room);
      await scheduleServerRoomRealtimeBroadcast(
        storedRoom.code,
        getRoomEventsAfterRevision(storedRoom, previousRevision, { includeSubmittedAnswers: true }),
        { includeSubmittedAnswers: true }
      );
      return storedRoom;
    }
    return room;
  }
  if (!options.skipHostTransfer) {
    const promotedRoom = transferRoomHostToOldestPlayer(room, "host-reconnect-timeout");
    if (promotedRoom) {
      const storedRoom = await backendStore.upsertRoom(promotedRoom);
      await scheduleServerRoomRealtimeBroadcast(
        storedRoom.code,
        getRoomEventsAfterRevision(storedRoom, previousRevision, { includeSubmittedAnswers: true }),
        { includeSubmittedAnswers: true }
      );
      return storedRoom;
    }
  }
  await closeStoredRoom(room.code, "host-disconnected", room);
  return null;
}

async function listRoomsForDirectory() {
  const rooms = await backendStore.listRooms();
  const checked = await Promise.all(rooms.map(async (room) => {
    const check = async () => ensureRoomReconnectGrace(
      await backendStore.getRoom(room?.code) || room
    );
    if (room?.code && typeof backendStore.withRoomLock === "function") {
      return backendStore.withRoomLock(room.code, check);
    }
    return check();
  }));
  return checked.filter(Boolean);
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
    usedHintRound: 0,
    status: active ? getParticipantDefaultStatus(role) : String(participant.status || getParticipantDefaultStatus(role)).slice(0, 32)
  };
}

function applyRoomRoundPreparationState(room, options = {}) {
  const normalizedCode = String(options.normalizedCode || room.code || "").trim().toUpperCase();
  const currentGame = options.currentGame && typeof options.currentGame === "object"
    ? options.currentGame
    : room.game && typeof room.game === "object"
      ? room.game
      : null;
  const currentMatchId = String(currentGame?.matchId || "").slice(0, 80);
  const matchId = String(options.matchId || currentMatchId || `${normalizedCode}-${Date.now()}`).slice(0, 80);
  const round = clampServerNumber(options.round, 1, 100, 1);
  const matchSettings = normalizeRoomGameSettings(options.matchSettings || currentGame?.matchSettings || room.settings);
  const now = Date.now();

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
    powerState: currentMatchId === matchId
      ? currentGame?.powerState || options.powerState || null
      : options.powerState || null,
    setupStartedAt: now,
    roundStartedAt: 0,
    updatedAt: now
  });

  if (options.stampEvent !== false) {
    stampRoomEvent(room, "round_advancing", {
      clientEventId: getRoomClientEventId(options),
      round,
      matchId,
      hostParticipantId: String(options.hostParticipantId || "").slice(0, 80),
      matchSettings,
      game: room.game
    });
  }
  return room.game;
}

function cloneRoomStateForRecovery(room = {}) {
  try {
    if (typeof structuredClone === "function") {
      return structuredClone(room);
    }
  } catch {
    // Fall through to the JSON-safe room shape used by the backend store.
  }
  return JSON.parse(JSON.stringify(room || {}));
}

function restoreRoomAfterRoundSetupFailure(room, stableRoom, command = {}) {
  const preservedEvents = normalizeRoomEvents(room?.events);
  const preservedRevision = getRoomRevision(room);
  const restoredRoom = cloneRoomStateForRecovery(stableRoom || {});
  Object.keys(room).forEach((key) => {
    delete room[key];
  });
  Object.assign(room, restoredRoom);
  room.events = preservedEvents;
  room.revision = preservedRevision;
  room.updatedAt = Date.now();
  finalizeRoom(room);

  const failureMessage = "The shared question could not be prepared. The room was returned to its previous state.";
  const game = room.game && typeof room.game === "object" ? room.game : null;
  stampRoomEvent(room, "round_setup_failed", {
    clientEventId: command.clientEventId,
    actorId: command.participantId,
    status: room.status,
    previousStatus: stableRoom?.status || "lobby",
    matchId: String(command.payload?.matchId || game?.matchId || "").slice(0, 80),
    round: clampServerNumber(command.payload?.round || command.payload?.nextRound || game?.round, 0, 100, 0),
    message: failureMessage,
    room: null,
    game: game || null
  });
  const failureEvent = room.events[room.events.length - 1];
  if (failureEvent?.payload) {
    // The recovery snapshot must carry the revision of the recovery event,
    // otherwise clients that already saw the preparing event will reject it
    // as an older snapshot and remain stuck in the loading phase.
    failureEvent.payload.room = sanitizeRoomForClient({ ...room, events: [] }, { includeSubmittedAnswers: true });
  }
  finalizeRoom(room);
  return { room, message: failureMessage };
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
  const requestedMultiplier = clampServerNumber(
    action?.multiplier || body.timerMultiplier,
    2,
    4,
    2
  );
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
        if ((Number(timer.speedMultiplier) || 1) >= requestedMultiplier) {
          return [participantId, timer];
        }
        return [participantId, {
          ...timer,
          endsAt: now + Math.ceil(remainingMs / requestedMultiplier),
          speedMultiplier: requestedMultiplier,
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
    usedHint: Boolean(participant.usedHintRound === Number(round)),
    remainingTime: clampServerNumber(participant.remainingTime, 0, 600, 0),
    matchId,
    round
  };
}

function getRoomSubmissionStatusSnapshot(room = {}, matchId = "", round = 0) {
  const game = room.game && typeof room.game === "object" ? room.game : {};
  const normalizedMatchId = String(matchId || game.matchId || "").slice(0, 80);
  const normalizedRound = clampServerNumber(round || game.round, 0, 100, 0);
  const answers = normalizeRoomAnswerState(game.answers, normalizedMatchId, normalizedRound);
  const statuses = getRoomGameplayParticipants(room)
    .map((participant) => {
      const participantId = String(participant.id || "").slice(0, 80);
      if (!participantId) {
        return null;
      }
      const answer = getParticipantAnswerStateForRound(participant, answers, normalizedMatchId, normalizedRound);
      return {
        participantId,
        status: answer ? answer.status : "pending",
        autoSubmitted: Boolean(answer?.autoSubmitted),
        remainingTime: answer ? clampServerNumber(answer.remainingTime, 0, 600, 0) : null
      };
    })
    .filter(Boolean);
  const submittedParticipantIds = statuses
    .filter((entry) => entry.status === "submitted" || entry.status === "timed_out")
    .map((entry) => entry.participantId);
  const pendingParticipantIds = statuses
    .filter((entry) => entry.status === "pending")
    .map((entry) => entry.participantId);
  return {
    matchId: normalizedMatchId,
    round: normalizedRound,
    submittedParticipantIds,
    pendingParticipantIds,
    allSubmitted: pendingParticipantIds.length === 0,
    statuses
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
    usedHint: Boolean(submission.usedHint || options.usedHint),
    remainingTime: clampServerNumber(submission.remainingTime, 0, 600, 0),
    matchId: String(options.matchId || "").slice(0, 80),
    round: clampServerNumber(options.round, 0, 100, 0)
  };
}

function pickRoomBotAutoAnswer(room = {}, participant = {}, slot = 0) {
  const game = room.game && typeof room.game === "object" ? room.game : {};
  const setup = game.setup && typeof game.setup === "object" ? game.setup : {};
  const seed = `${game.matchId || room.code || "room"}-${game.round || 0}-${participant.id || slot}`;
  const pool = uniqueAnswers([
    ...(Array.isArray(setup.botCards) ? setup.botCards : []),
    ...(Array.isArray(setup.botAnswerPool) ? setup.botAnswerPool : []),
    ...(Array.isArray(setup.botWrongPool) ? setup.botWrongPool : []),
    ...(Array.isArray(setup.multipleChoiceOptions) ? setup.multipleChoiceOptions : []),
    setup.canonicalAnswer,
    ...(Array.isArray(setup.acceptedAnswers) ? setup.acceptedAnswers : [])
  ]);
  return pickFromPool(pool, seed) || "Not sure";
}

function autoSubmitRoomBotsWhenOnlyBotsPending(room, options = {}) {
  const game = room.game && typeof room.game === "object" ? room.game : null;
  if (!game || room.status !== "in-progress" || game.status !== "playing") {
    return [];
  }
  const matchId = String(options.matchId || game.matchId || "").slice(0, 80);
  const round = clampServerNumber(options.round || game.round, 0, 100, 0);
  if (!matchId || !round) {
    return [];
  }
  const participants = getRoomGameplayParticipants(room);
  const answers = normalizeRoomAnswerState(game.answers, matchId, round);
  const pendingParticipants = participants.filter((participant) => !getParticipantAnswerStateForRound(participant, answers, matchId, round));
  const pendingBots = pendingParticipants.filter((participant) => normalizeParticipantRole(participant) === "bot");
  const pendingRealPlayers = pendingParticipants.filter((participant) => normalizeParticipantRole(participant) !== "bot");
  if (!pendingBots.length || (pendingRealPlayers.length && !options.forceBots)) {
    return [];
  }
  const now = Date.now();
  const requestedSubmissions = getRoomGradingSubmissionMap(options.submissions);
  let nextGame = game;
  const submittedBots = [];
  pendingBots.forEach((bot, index) => {
    const participantId = String(bot.id || "").slice(0, 80);
    if (!participantId) {
      return;
    }
    const timer = nextGame.participantTimers?.[participantId];
    const remainingTime = timer && String(timer.status || "").toLowerCase() !== "ended"
      ? Math.max(0, Math.ceil(((Number(timer.endsAt) || now) - now) / 1000))
      : 0;
    const requested = requestedSubmissions.get(participantId);
    const answerState = {
      participantId,
      status: "submitted",
      answer: String(requested?.answer || pickRoomBotAutoAnswer(room, bot, index)).slice(0, 500),
      submittedAt: now,
      autoSubmitted: true,
      usedHint: Boolean(requested?.usedHint),
      remainingTime: requested ? clampServerNumber(requested.remainingTime, 0, 600, remainingTime) : remainingTime,
      matchId,
      round
    };
    answers[participantId] = answerState;
    applyAnswerStateToParticipant(bot, answerState);
    nextGame = updateRoomParticipantTimerStatus({
      ...nextGame,
      answers: {
        ...(nextGame.answers || {}),
        [participantId]: answerState
      },
      updatedAt: now
    }, participantId, { status: "ended", now });
    stampRoomEvent(room, "answer_submitted", {
      clientEventId: options.clientEventId,
      actorId: participantId,
      participantId,
      participantName: bot.name || "Bot",
      role: "bot",
      host: false,
      spectator: false,
      status: bot.status,
      participant: sanitizeParticipantForClient(bot, { includeSubmittedAnswers: true }),
      matchId,
      round,
      answer: answerState.answer,
      remainingTime,
      submissionStatus: "submitted",
      autoSubmitted: true
    });
    submittedBots.push(answerState);
  });
  room.game = normalizeRoomGame({
    ...nextGame,
    answers,
    updatedAt: now
  });
  return submittedBots;
}

function applyAnswerStateToParticipant(participant = {}, answerState = {}) {
  participant.status = "submitted";
  participant.answer = String(answerState.answer || "").slice(0, 500);
  participant.submittedRound = clampServerNumber(answerState.round, 0, 100, 0);
  participant.submissionMatchId = String(answerState.matchId || "").slice(0, 80);
  participant.remainingTime = clampServerNumber(answerState.remainingTime, 0, 600, 0);
  participant.submittedAt = clampServerNumber(answerState.submittedAt, 0, Number.MAX_SAFE_INTEGER, Date.now());
  participant.usedHintRound = answerState.usedHint ? clampServerNumber(answerState.round, 0, 100, 0) : 0;
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
        autoSubmitted: Boolean(answerState.autoSubmitted),
        usedHint: Boolean(answerState.usedHint)
      };
    })
    .filter(Boolean);
}

function startRoomGradingTransition(room, options = {}) {
  let game = room.game && typeof room.game === "object" ? room.game : null;
  if (!game || room.status !== "in-progress") {
    return { started: false, duplicate: false, pendingParticipantIds: [] };
  }
  const matchId = String(game.matchId || options.matchId || "").slice(0, 80);
  const round = clampServerNumber(game.round || options.round, 0, 100, 0);
  if (!matchId || !round) {
    return { started: false, duplicate: false, pendingParticipantIds: [] };
  }
  const participants = getRoomGameplayParticipants(room);
  // Grading is a server transition. If a client submits the last real answer
  // or resolves the timer, finish every pending bot in this same mutation so
  // no browser-side bot request can delay or race grading.
  autoSubmitRoomBotsWhenOnlyBotsPending(room, {
    matchId,
    round,
    clientEventId: options.clientEventId,
    submissions: options.submissions,
    forceBots: Boolean(options.force || String(options.reason || "") === "timer-expired")
  });
  game = room.game && typeof room.game === "object" ? room.game : game;
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
        autoSubmitted: !submission || reason === "timer-expired",
        usedHint: Boolean(submission?.usedHint || game.hints?.[participantId]?.usedRounds?.[String(round)])
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
        clientEventId: getRoomClientEventId(options),
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
    clientEventId: getRoomClientEventId(options),
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
        usedHint: Boolean(source.usedHint),
        submittedAt: clampServerNumber(source.submittedAt, 0, Number.MAX_SAFE_INTEGER, 0)
      };
    })
    .filter((entry) => entry.participantId)
    .slice(0, 10);
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
    questionLanguage: normalizeQuestionLanguage(source.questionLanguage || source.language),
    harsh: classicMode ? false : Boolean(source.harsh),
    chaos: classicMode ? false : Boolean(source.chaos),
    timeMoney: classicMode ? false : Boolean(source.timeMoney),
    amplified: classicMode ? false : Boolean(source.amplified),
    wildFire: classicMode ? false : Boolean(source.wildFire),
    partyMayhem: classicMode ? false : Boolean(source.partyMayhem),
    mutation: classicMode ? false : Boolean(source.mutation),
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
  const status = String(participant?.status || "").trim().toLowerCase();
  return participant?.active !== false
    && normalizeParticipantRole(participant) !== "spectator"
    && !["banned", "kicked", "left", "disconnected", "host-disconnected", "spectator-disconnected"].includes(status);
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

function getRoomParticipantAnswerStateForCurrentRound(room = {}, participant = {}) {
  const game = room.game && typeof room.game === "object" ? room.game : null;
  if (!game) {
    return null;
  }
  const matchId = String(game.matchId || "").slice(0, 80);
  const round = clampServerNumber(game.round, 0, 100, 0);
  const answers = normalizeRoomAnswerState(game.answers, matchId, round);
  return getParticipantAnswerStateForRound(participant, answers, matchId, round);
}

function getRoomParticipantReconnectStatus(room = {}, existingParticipant = {}, incomingStatus = "") {
  const role = normalizeParticipantRole(existingParticipant);
  if (role === "host") {
    return "host";
  }
  if (role === "bot") {
    return "bot";
  }
  if (role === "spectator") {
    return "spectating";
  }
  const fallbackStatus = String(incomingStatus || existingParticipant.status || getParticipantDefaultStatus(role)).slice(0, 32);
  const game = room.game && typeof room.game === "object" ? room.game : null;
  if (room.status !== "in-progress" || !game) {
    return fallbackStatus;
  }
  const answerState = getRoomParticipantAnswerStateForCurrentRound(room, existingParticipant);
  if (answerState) {
    return "submitted";
  }
  const existingStatus = String(existingParticipant.status || "").slice(0, 32);
  if (["playing", "waiting", "submitted"].includes(existingStatus)) {
    return existingStatus;
  }
  return fallbackStatus;
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
    tabSessionId: String(participant.tabSessionId || "").slice(0, 120),
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
    answerDraft: String(participant.answerDraft || "").slice(0, 500),
    currentAnswer: String(participant.currentAnswer || "").slice(0, 500),
    submittedRound: clampServerNumber(participant.submittedRound, 0, 100, 0),
    submissionMatchId: String(participant.submissionMatchId || "").slice(0, 80),
    remainingTime: clampServerNumber(participant.remainingTime, 0, 600, 0),
    usedHintRound: clampServerNumber(participant.usedHintRound, 0, 100, 0),
    disconnectedAt: clampServerNumber(participant.disconnectedAt, 0, Number.MAX_SAFE_INTEGER, 0),
    lastConnectedAt: clampServerNumber(participant.lastConnectedAt, 0, Number.MAX_SAFE_INTEGER, 0),
    lastSeenAt: normalizeServerTimestamp(participant.lastSeenAt, 0),
    joinedAt: clampServerNumber(participant.joinedAt, 0, Number.MAX_SAFE_INTEGER, 0)
  };
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
        revision: clampServerNumber(source.revision, 0, Number.MAX_SAFE_INTEGER, 0),
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

function normalizeRoomHintStateMap(hints = {}) {
  const source = hints && typeof hints === "object" && !Array.isArray(hints) ? hints : {};
  return Object.fromEntries(Object.entries(source).map(([participantId, value]) => {
    const entry = value && typeof value === "object" ? value : {};
    const usedRounds = entry.usedRounds && typeof entry.usedRounds === "object" ? entry.usedRounds : {};
    return [String(participantId || "").slice(0, 80), {
      matchId: String(entry.matchId || "").slice(0, 80),
      freeRemaining: clampServerNumber(entry.freeRemaining, 0, 3, 0),
      purchasesUsed: clampServerNumber(entry.purchasesUsed, 0, 2, 0),
      usedRounds: Object.fromEntries(Object.entries(usedRounds)
        .filter(([, used]) => Boolean(used))
        .slice(-100))
    }];
  }).filter(([participantId]) => participantId));
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
    hints: normalizeRoomHintStateMap(game.hints),
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
            usedHint: Boolean(answerState.usedHint),
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
    questionLanguage: normalizeQuestionLanguage(source.questionLanguage || source.language),
    harsh: classicMode ? false : Boolean(source.harsh),
    chaos: classicMode ? false : Boolean(source.chaos),
    timeMoney: classicMode ? false : Boolean(source.timeMoney),
    amplified: classicMode ? false : Boolean(source.amplified),
    wildFire: classicMode ? false : Boolean(source.wildFire),
    partyMayhem: classicMode ? false : Boolean(source.partyMayhem),
    mutation: classicMode ? false : Boolean(source.mutation),
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

function getRoomPowerAuthMode() {
  const mode = String(process.env.POWER_AUTH_MODE || "warn").trim().toLowerCase();
  return ["warn", "enforce"].includes(mode) ? mode : "warn";
}

function getServerBasePowerId(powerId = "") {
  const normalized = String(powerId || "").trim().toLowerCase();
  return normalized.endsWith(chaosInfusedPowerSuffix)
    ? normalized.slice(0, -chaosInfusedPowerSuffix.length)
    : normalized;
}

function isServerChaosInfusedPower(powerId = "") {
  return String(powerId || "").trim().toLowerCase().endsWith(chaosInfusedPowerSuffix);
}

function isServerPowerEngineMigrated(powerId = "") {
  return serverPowerEngineMigratedIds.has(getServerBasePowerId(powerId));
}

function cloneRoomPowerActionMeta(meta) {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) {
    return {};
  }
  try {
    const serialized = JSON.stringify(meta);
    if (serialized.length > 12000) {
      return {};
    }
    const cloned = JSON.parse(serialized);
    return cloned && typeof cloned === "object" && !Array.isArray(cloned) ? cloned : {};
  } catch {
    return {};
  }
}

function cloneServerRoomJson(value, fallback, maxBytes = 120000) {
  if (value === undefined || value === null) {
    return fallback;
  }
  try {
    const serialized = JSON.stringify(value);
    if (serialized.length > maxBytes) {
      return fallback;
    }
    return JSON.parse(serialized);
  } catch {
    return fallback;
  }
}

function normalizeRoomPowerAction(action, body = {}) {
  const source = action && typeof action === "object" ? action : {};
  const bodyTargetIds = Array.isArray(body.targetParticipantIds) ? body.targetParticipantIds : [];
  const sourceTargetIds = Array.isArray(source.targetParticipantIds) ? source.targetParticipantIds : bodyTargetIds;
  const targetParticipantIds = [...new Set(sourceTargetIds
    .map((participantId) => String(participantId || "").trim().slice(0, 120))
    .filter(Boolean))].slice(0, 10);
  const targetParticipantId = String(
    source.targetParticipantId
    || body.targetParticipantId
    || targetParticipantIds[0]
    || ""
  ).trim().slice(0, 120);
  if (targetParticipantId && !targetParticipantIds.includes(targetParticipantId)) {
    targetParticipantIds.unshift(targetParticipantId);
  }
  return {
    version: clampServerNumber(source.version, 1, 10, 1),
    type: String(source.type || "use").trim().toLowerCase().slice(0, 30),
    powerId: String(source.powerId || body.powerId || "").trim().slice(0, 80),
    actorParticipantId: String(source.actorParticipantId || body.actorParticipantId || "").trim().slice(0, 120),
    targetParticipantId,
    targetParticipantIds,
    matchId: String(source.matchId || body.matchId || "").trim().slice(0, 80),
    round: clampServerNumber(source.round || body.round, 0, 100, 0),
    meta: cloneRoomPowerActionMeta(source.meta || body.actionMeta)
  };
}

function getRoomPowerStateEntriesWithReplacement(entries = [], participantId = "", replacement = null) {
  const id = String(participantId || "").slice(0, 120);
  const result = (Array.isArray(entries) ? entries : [])
    .filter((entry) => String(entry?.participantId || "").slice(0, 120) !== id);
  if (replacement?.participantId) {
    result.push(replacement);
  }
  return result.slice(0, 10);
}

function getRoomPowerActionPlayedIds(powerState = {}, participantId = "") {
  const entry = getRoomPowerStateEntry(powerState?.played, participantId);
  return new Set([
    entry?.primaryPowerId,
    ...(Array.isArray(entry?.stacks) ? entry.stacks.map((stack) => stack?.powerId) : [])
  ].map((powerId) => String(powerId || "").trim()).filter(Boolean));
}

function getServerPowerPlayerMap(powerState = {}) {
  const map = new Map();
  (Array.isArray(powerState?.players) ? powerState.players : []).forEach((entry) => {
    const participantId = String(entry?.participantId || "").slice(0, 120);
    if (participantId) {
      map.set(participantId, entry);
    }
  });
  return map;
}

function getRoomGameplayParticipantIds(room = {}) {
  return (Array.isArray(room?.participants) ? room.participants : [])
    .filter(isGameplayParticipant)
    .map((participant) => String(participant.id || "").slice(0, 120))
    .filter(Boolean);
}

function getServerPowerRuleRequiredPlayerIds(room, powerState, action) {
  const basePowerId = getServerBasePowerId(action?.powerId);
  const actorId = String(action?.actorParticipantId || "").slice(0, 120);
  const targetId = String(action?.targetParticipantId || "").slice(0, 120);
  const gameplayIds = getRoomGameplayParticipantIds(room);
  if (!isServerPowerEngineMigrated(action?.powerId)) {
    return [];
  }
  if (basePowerId === "time_bender") {
    return [];
  }
  if (basePowerId === "sin_pride" || basePowerId === "hard_reset") {
    return gameplayIds;
  }
  if ((basePowerId === "lightning_strike" || basePowerId === "zap_strike") && isServerChaosInfusedPower(action?.powerId)) {
    return gameplayIds;
  }
  if (basePowerId === "lightning_strike" || basePowerId === "zap_strike") {
    return [targetId].filter(Boolean);
  }
  if (basePowerId === "shameless") {
    return [actorId, targetId].filter(Boolean);
  }
  return [actorId].filter(Boolean);
}

function getServerPowerEffectStackCount(value) {
  if (!value) {
    return 0;
  }
  if (value === true || typeof value === "string") {
    return 1;
  }
  if (typeof value === "number") {
    return Math.max(0, Math.floor(value));
  }
  if (typeof value === "object") {
    const directCount = Number(value.count ?? value.stacks);
    if (Number.isFinite(directCount) && directCount > 0) {
      return Math.floor(directCount);
    }
    return Math.max(0, Math.floor(Number(value.normal) || 0))
      + Math.max(0, Math.floor(Number(value.chaos) || 0));
  }
  return 0;
}

function getServerPowerEffectMaps(effects = {}) {
  if (!effects || typeof effects !== "object") {
    return {};
  }
  return effects.maps && typeof effects.maps === "object" ? effects.maps : {};
}

function getServerPowerOwnerEffect(effects, key, owner = "") {
  const maps = getServerPowerEffectMaps(effects);
  const map = maps[key] && typeof maps[key] === "object" ? maps[key] : {};
  return map[String(owner || "")];
}

function setServerPowerOwnerEffect(effects, key, owner = "", value) {
  if (!effects || typeof effects !== "object" || !owner) {
    return;
  }
  effects.maps = effects.maps && typeof effects.maps === "object" ? effects.maps : {};
  effects.maps[key] = effects.maps[key] && typeof effects.maps[key] === "object" ? effects.maps[key] : {};
  if (value === undefined || value === null || value === false || value === 0) {
    delete effects.maps[key][owner];
  } else {
    effects.maps[key][owner] = value;
  }
}

function hasServerPowerOwnerEffect(effects, key, owner = "") {
  return getServerPowerEffectStackCount(getServerPowerOwnerEffect(effects, key, owner)) > 0;
}

function hasServerImmediateDeductionProtection(effects, owner = "") {
  return hasServerPowerOwnerEffect(effects, "ultimatumRounds", owner)
    || hasServerPowerOwnerEffect(effects, "permafrostProtection", owner)
    || hasServerPowerOwnerEffect(effects, "freezeProtection", owner)
    || hasServerPowerOwnerEffect(effects, "pocketShieldCharges", owner);
}

function applyServerProtectedScoreLoss(playerById, effects, participantId = "", amount = 0) {
  const player = playerById.get(String(participantId || "").slice(0, 120));
  if (!player) {
    return 0;
  }
  const owner = String(player.owner || "").slice(0, 80);
  const loss = Math.max(0, Math.round(Number(amount) || 0));
  if (loss <= 0) {
    return 0;
  }
  if (owner && hasServerPowerOwnerEffect(effects, "freezeReflectionRounds", owner)) {
    player.score = Math.max(0, Math.round(Number(player.score) || 0) + loss);
    return 0;
  }
  if (owner && hasServerImmediateDeductionProtection(effects, owner)) {
    const shieldCharges = getServerPowerEffectStackCount(getServerPowerOwnerEffect(effects, "pocketShieldCharges", owner));
    if (shieldCharges > 0) {
      const breakThreshold = getServerPowerEffectStackCount(getServerPowerOwnerEffect(effects, "pocketShieldBreakThresholds", owner));
      if (!breakThreshold || loss > breakThreshold) {
        const nextCharges = Math.max(0, shieldCharges - 1);
        setServerPowerOwnerEffect(effects, "pocketShieldCharges", owner, nextCharges);
        if (nextCharges <= 0) {
          setServerPowerOwnerEffect(effects, "pocketShieldBreakThresholds", owner, 0);
        }
      }
    }
    return 0;
  }
  player.score = Math.max(0, Math.round(Number(player.score) || 0) - loss);
  return loss;
}

function addServerPowerScore(playerById, participantId = "", amount = 0) {
  const player = playerById.get(String(participantId || "").slice(0, 120));
  if (!player) {
    return;
  }
  player.score = Math.max(0, Math.round(Number(player.score) || 0) + Math.round(Number(amount) || 0));
}

function setServerPowerStreak(playerById, participantId = "", value = 0) {
  const player = playerById.get(String(participantId || "").slice(0, 120));
  if (!player) {
    return;
  }
  player.streak = Math.max(0, Math.round(Number(value) || 0));
}

function canServerReduceStreak(playerById, effects, participantId = "", options = {}) {
  const player = playerById.get(String(participantId || "").slice(0, 120));
  const owner = String(player?.owner || "").slice(0, 80);
  if (!player || !owner) {
    return false;
  }
  if (hasServerPowerOwnerEffect(effects, "ultimatumRounds", owner)
    || hasServerPowerOwnerEffect(effects, "doomStreakGuardRounds", owner)) {
    return false;
  }
  if (options.force) {
    return true;
  }
  if (hasServerPowerOwnerEffect(effects, "streakSicknessRounds", owner)
    || hasServerPowerOwnerEffect(effects, "streakFreezeRounds", owner)
    || hasServerPowerOwnerEffect(effects, "streakLossProtectionRounds", owner)
    || hasServerPowerOwnerEffect(effects, "eternalFlameProtection", owner)) {
    return false;
  }
  const anchorCharges = getServerPowerEffectStackCount(getServerPowerOwnerEffect(effects, "streakAnchorCharges", owner));
  if (anchorCharges > 0) {
    setServerPowerOwnerEffect(effects, "streakAnchorCharges", owner, Math.max(0, anchorCharges - 1));
    return false;
  }
  return true;
}

function validateRoomPowerActionIntent(room, previousPowerState, action, actorParticipantId = "") {
  const actorId = String(actorParticipantId || "").trim().slice(0, 120);
  const currentMatchId = String(room?.game?.matchId || "").trim().slice(0, 80);
  const currentRound = clampServerNumber(room?.game?.round, 0, 100, 0);
  if (!action || !["use", "effect_sync"].includes(action.type)) {
    return { status: 400, error: "Power use needs a valid action intent." };
  }
  if (action.type === "effect_sync") {
    if (action.powerId && !action.powerId.includes("cocktail_mix") && !action.powerId.includes("xray_hacks")) {
      return { status: 400, error: "Effect sync is only available for persistent power effects." };
    }
    if (action.actorParticipantId && action.actorParticipantId !== actorId) {
      return { status: 403, error: "Effect sync actor does not match the authenticated participant." };
    }
    if (currentMatchId && action.matchId && action.matchId !== currentMatchId) {
      return { status: 409, error: "Effect state belongs to a previous match." };
    }
    if (currentRound && action.round && action.round !== currentRound) {
      return { status: 409, error: "Effect state belongs to a different round." };
    }
    if (String(room?.game?.status || "") !== "playing") {
      return { status: 409, error: "Effects cannot be updated outside an active round." };
    }
    return null;
  }
  if (!action.powerId) {
    return { status: 400, error: "Power use action is missing a power id." };
  }
  if (action.actorParticipantId && action.actorParticipantId !== actorId) {
    return { status: 403, error: "Power use actor does not match the authenticated participant." };
  }
  if (currentMatchId && action.matchId && action.matchId !== currentMatchId) {
    return { status: 409, error: "Power action belongs to a previous match." };
  }
  if (currentRound && action.round && action.round !== currentRound) {
    return { status: 409, error: "Power action belongs to a different round." };
  }
  if (String(room?.game?.status || "") !== "playing") {
    return { status: 409, error: "Power cannot be used outside an active round." };
  }

  const gameplayParticipantIds = getRoomGameplayParticipantIdSet(room);
  const targetIds = action.targetParticipantIds.length
    ? action.targetParticipantIds
    : action.targetParticipantId
      ? [action.targetParticipantId]
      : [];
  const invalidTarget = targetIds.find((participantId) => !gameplayParticipantIds.has(participantId));
  if (invalidTarget) {
    return { status: 404, error: "Power target is not an active player in this room." };
  }

  const previousHand = getRoomPowerStateEntry(previousPowerState?.hands, actorId);
  if (!previousHand) {
    return { status: 409, error: "The server has not received this participant's power hand yet." };
  }
  const handIds = new Set((previousHand.hand || []).map((powerId) => String(powerId || "").trim()));
  if (!handIds.has(action.powerId)) {
    return { status: 409, error: "Power is not in this participant's authoritative hand.", powerId: action.powerId };
  }
  if (getRoomPowerActionPlayedIds(previousPowerState, actorId).has(action.powerId)) {
    return { status: 409, error: "This power has already been used this round.", powerId: action.powerId };
  }
  if (isServerPowerEngineMigrated(action.powerId)) {
    const basePowerId = getServerBasePowerId(action.powerId);
    const chaosInfused = isServerChaosInfusedPower(action.powerId);
    const requiresTarget = basePowerId === "shameless"
      || ((basePowerId === "lightning_strike" || basePowerId === "zap_strike") && !chaosInfused)
      || (basePowerId === "hard_reset" && chaosInfused);
    if (requiresTarget && !action.targetParticipantId) {
      return { status: 400, error: "This power needs a valid target.", powerId: action.powerId };
    }
    if (basePowerId === "shameless" && action.targetParticipantId === actorId) {
      return { status: 409, error: "This power must target another player.", powerId: action.powerId };
    }
    const playerById = getServerPowerPlayerMap(previousPowerState);
    const missingPlayerStateId = getServerPowerRuleRequiredPlayerIds(room, previousPowerState, action)
      .find((participantId) => !playerById.has(participantId));
    if (missingPlayerStateId) {
      return { status: 409, error: "The server needs current score and streak state before resolving this power.", powerId: action.powerId };
    }
    if (basePowerId === "sin_pride") {
      const actorPlayer = playerById.get(actorId);
      const highestScore = Math.max(...[...playerById.values()].map((entry) => Math.max(0, Number(entry.score) || 0)));
      if (!actorPlayer || Math.max(0, Number(actorPlayer.score) || 0) < highestScore) {
        return { status: 409, error: "Sin of Pride is only usable from first place.", powerId: action.powerId };
      }
    }
  }
  return null;
}

function applyServerPowerAction(previousPowerState, action, clientEventId = "") {
  const previous = normalizeRoomPowerState(previousPowerState);
  if (!previous) {
    return null;
  }
  const actorId = action.actorParticipantId;
  const previousHand = getRoomPowerStateEntry(previous.hands, actorId);
  const previousPlayed = getRoomPowerStateEntry(previous.played, actorId) || {
    participantId: actorId,
    owner: "",
    revision: 0,
    updatedAt: previous.updatedAt || Date.now(),
    stacks: [],
    primaryPowerId: "",
    meta: null
  };
  const now = Date.now();
  const revealId = `server-${String(clientEventId || `${action.matchId}-${action.round}`).slice(0, 100)}`;
  const basePowerId = getServerBasePowerId(action.powerId);
  const chaosInfused = isServerChaosInfusedPower(action.powerId);
  const nextEffects = cloneServerRoomJson(previous.effects, null);
  const playerById = new Map(previous.players.map((entry) => [
    entry.participantId,
    { ...entry }
  ]));
  const originalPlayerSignatures = new Map(previous.players.map((entry) => [
    entry.participantId,
    `${Math.max(0, Number(entry.score) || 0)}|${Math.max(0, Number(entry.streak) || 0)}`
  ]));
  const markUpdatedPlayer = (participantId) => {
    const player = playerById.get(String(participantId || "").slice(0, 120));
    if (player) {
      player.updatedAt = now;
    }
  };
  const getPlayerScore = (participantId) => Math.max(0, Number(playerById.get(participantId)?.score) || 0);
  const getPlayerStreak = (participantId) => Math.max(0, Number(playerById.get(participantId)?.streak) || 0);
  const addScore = (participantId, amount) => {
    const before = getPlayerScore(participantId);
    addServerPowerScore(playerById, participantId, amount);
    if (getPlayerScore(participantId) !== before) {
      markUpdatedPlayer(participantId);
    }
  };
  const applyLoss = (participantId, amount) => {
    const before = getPlayerScore(participantId);
    const appliedLoss = applyServerProtectedScoreLoss(playerById, nextEffects, participantId, amount);
    if (getPlayerScore(participantId) !== before) {
      markUpdatedPlayer(participantId);
    }
    return appliedLoss;
  };
  const setStreak = (participantId, value) => {
    const before = getPlayerStreak(participantId);
    setServerPowerStreak(playerById, participantId, value);
    if (getPlayerStreak(participantId) !== before) {
      markUpdatedPlayer(participantId);
    }
  };
  const nextMeta = {
    ...cloneRoomPowerActionMeta(action.meta),
    serverResolved: true,
    targetParticipantId: action.targetParticipantId,
    targetParticipantIds: action.targetParticipantIds
  };
  if (basePowerId === "lightning_strike" || basePowerId === "zap_strike") {
    const affectedParticipantIds = [];
    let appliedLoss = 0;
    if (chaosInfused) {
      const actorStreak = getPlayerStreak(actorId);
      const amountPerStreak = basePowerId === "lightning_strike" ? 750 : 300;
      const streakOffset = basePowerId === "lightning_strike" ? 2 : 1;
      [...playerById.values()]
        .filter((entry) => entry.participantId !== actorId && getPlayerStreak(entry.participantId) > actorStreak)
        .forEach((entry) => {
          const amount = amountPerStreak * (getPlayerStreak(entry.participantId) + streakOffset);
          const targetLoss = applyLoss(entry.participantId, amount);
          appliedLoss += targetLoss;
          affectedParticipantIds.push(entry.participantId);
        });
    } else if (action.targetParticipantId && getPlayerStreak(action.targetParticipantId) > 0) {
      const amount = (basePowerId === "lightning_strike" ? 500 : 250) * (getPlayerStreak(action.targetParticipantId) + 1);
      appliedLoss = applyLoss(action.targetParticipantId, amount);
      affectedParticipantIds.push(action.targetParticipantId);
    }
    nextMeta.appliedLoss = appliedLoss;
    nextMeta.affectedParticipantIds = affectedParticipantIds;
    if (!nextMeta.targetParticipantIds?.length && affectedParticipantIds.length) {
      nextMeta.targetParticipantIds = affectedParticipantIds;
    }
  }
  if (basePowerId === "shameless") {
    const targetId = action.targetParticipantId;
    let stolenAmount = 0;
    if (targetId && targetId !== actorId) {
      const amount = Math.floor(getPlayerScore(targetId) * (chaosInfused ? 0.18 : 0.05));
      stolenAmount = applyLoss(targetId, amount);
      addScore(actorId, stolenAmount);
    }
    nextMeta.stolenAmount = stolenAmount;
    nextMeta.appliedLoss = stolenAmount;
  }
  if (basePowerId === "sin_pride") {
    const currentStreak = getPlayerStreak(actorId);
    if (chaosInfused) {
      setStreak(actorId, currentStreak * 2);
      nextMeta.previousStreak = currentStreak;
      nextMeta.nextStreak = getPlayerStreak(actorId);
    } else {
      addScore(actorId, 250);
      setStreak(actorId, currentStreak + 1);
      nextMeta.appliedPoints = 250;
      nextMeta.streakGain = 1;
    }
  }
  if (basePowerId === "hard_reset") {
    const resetParticipantIds = [];
    const targets = chaosInfused
      ? [action.targetParticipantId].filter(Boolean)
      : [...playerById.keys()];
    targets.forEach((participantId) => {
      const player = playerById.get(participantId);
      const owner = String(player?.owner || "").slice(0, 80);
      if (!player || getPlayerStreak(participantId) <= 0) {
        return;
      }
      if (chaosInfused && owner && hasServerPowerOwnerEffect(nextEffects, "eternalFlameProtection", owner)) {
        return;
      }
      if (!canServerReduceStreak(playerById, nextEffects, participantId, { force: chaosInfused })) {
        return;
      }
      setStreak(participantId, 0);
      resetParticipantIds.push(participantId);
    });
    nextMeta.resetParticipantIds = resetParticipantIds;
  }
  const nextPlayers = [...playerById.values()].map((entry) => {
    const signature = `${Math.max(0, Number(entry.score) || 0)}|${Math.max(0, Number(entry.streak) || 0)}`;
    return signature === originalPlayerSignatures.get(entry.participantId)
      ? entry
      : { ...entry, updatedAt: now };
  });
  const nextHand = {
    ...previousHand,
    updatedAt: now,
    hand: previousHand.hand.filter((powerId) => powerId !== action.powerId),
    fresh: previousHand.fresh.filter((powerId) => powerId !== action.powerId)
  };
  const nextPlayed = {
    ...previousPlayed,
    updatedAt: now,
    stacks: [
      ...(Array.isArray(previousPlayed.stacks) ? previousPlayed.stacks : []),
      { powerId: action.powerId, revealId, meta: nextMeta }
    ].slice(-10),
    primaryPowerId: previousPlayed.primaryPowerId || action.powerId,
    meta: nextMeta
  };
  return {
    ...previous,
    matchId: action.matchId || previous.matchId,
    updatedAt: now,
    hands: getRoomPowerStateEntriesWithReplacement(previous.hands, actorId, nextHand),
    played: getRoomPowerStateEntriesWithReplacement(previous.played, actorId, nextPlayed),
    players: nextPlayers,
    effects: nextEffects
  };
}

function overlayServerPowerActionState(clientPowerState, serverPowerState, actorParticipantId = "") {
  const client = normalizeRoomPowerState(clientPowerState) || serverPowerState;
  const server = normalizeRoomPowerState(serverPowerState);
  if (!client || !server) {
    return server || client || null;
  }
  const actorId = String(actorParticipantId || "").slice(0, 120);
  return {
    ...client,
    matchId: server.matchId || client.matchId,
    updatedAt: Math.max(client.updatedAt || 0, server.updatedAt || 0),
    hands: getRoomPowerStateEntriesWithReplacement(client.hands, actorId, getRoomPowerStateEntry(server.hands, actorId)),
    played: getRoomPowerStateEntriesWithReplacement(client.played, actorId, getRoomPowerStateEntry(server.played, actorId))
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

function getRoomPowerStateEntry(entries = [], participantId = "") {
  const id = String(participantId || "").slice(0, 120);
  return (Array.isArray(entries) ? entries : []).find((entry) => String(entry?.participantId || "").slice(0, 120) === id) || null;
}

function getSubmittedRoomPowerUseIds(powerState = {}, actorParticipantId = "") {
  const actorPlayed = getRoomPowerStateEntry(powerState?.played, actorParticipantId);
  if (!actorPlayed) {
    return [];
  }
  const ids = new Set();
  if (actorPlayed.primaryPowerId) {
    ids.add(String(actorPlayed.primaryPowerId).slice(0, 80));
  }
  (Array.isArray(actorPlayed.stacks) ? actorPlayed.stacks : []).forEach((stack) => {
    const powerId = String(stack?.powerId || "").slice(0, 80);
    if (powerId) {
      ids.add(powerId);
    }
  });
  return [...ids].filter(Boolean);
}

function validateRoomPowerUseAuthority(room, previousPowerState, submittedPowerState, body = {}, actorParticipantId = "") {
  const actorId = String(actorParticipantId || "").slice(0, 120);
  const targetParticipantId = String(body.targetParticipantId || "").slice(0, 120);
  if (targetParticipantId) {
    const target = (Array.isArray(room?.participants) ? room.participants : [])
      .find((participant) => String(participant?.id || "").slice(0, 120) === targetParticipantId);
    if (!target || !isGameplayParticipant(target)) {
      return { status: 404, error: "Power target is not an active player in this room." };
    }
  }

  const usedPowerIds = getSubmittedRoomPowerUseIds(submittedPowerState, actorId);
  if (!usedPowerIds.length) {
    return null;
  }
  const previousHand = getRoomPowerStateEntry(previousPowerState?.hands, actorId);
  if (!previousHand) {
    return null;
  }
  const handIds = new Set((Array.isArray(previousHand.hand) ? previousHand.hand : [])
    .map((powerId) => String(powerId || "").slice(0, 80))
    .filter(Boolean));
  const missingPowerId = usedPowerIds.find((powerId) => !handIds.has(powerId));
  if (missingPowerId) {
    return { status: 409, error: "Power is not in this participant's authoritative hand.", powerId: missingPowerId };
  }
  return null;
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
  const canRepairMissingHost = Boolean(
    room.status !== "complete"
    && room.host?.id
    && (!room.participants.length || room.participants.some((participant) => {
      const role = normalizeParticipantRole(participant);
      return participant.active !== false && role !== "bot" && role !== "spectator";
    }))
  );
  if (!room.participants.some((participant) => normalizeParticipantRole(participant) === "host") && canRepairMissingHost) {
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

function normalizeServerTimestamp(value, fallback = 0) {
  if (Number.isFinite(Number(value))) {
    return clampServerNumber(value, 0, Number.MAX_SAFE_INTEGER, fallback);
  }
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? clampServerNumber(parsed, 0, Number.MAX_SAFE_INTEGER, fallback) : fallback;
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
    // These source files keep stable URLs, so clients must revalidate them
    // instead of running an earlier deployment for up to six hours.
    return "no-cache, must-revalidate";
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
    const questionLanguage = normalizeQuestionLanguage(body.questionLanguage || body.language);
    const baseSeed = String(body.setupSeed || `${Date.now()}-${Math.random()}`).slice(0, 80);
    const backgroundMode = Boolean(body.backgroundMode);
    const setupMode = body.setupMode === "room" ? "room" : "local";
    const round = clampServerNumber(body.round, 1, 100, 1);
    const totalRounds = clampServerNumber(body.totalRounds, 1, 100, 10);
    const result = await getSeedQuestionSetup({
      recentBlackCards,
      enabledThemes,
      preferredTheme,
      questionLanguage,
      setupSeed: baseSeed,
      backgroundMode,
      round,
      totalRounds,
      runtimeQuestionBank: setupMode === "room"
        ? await getRuntimeQuestionBank()
        : getFastLocalQuestionBank()
    });
    if (!result) {
      throw new Error("No seed questions are available for the selected themes.");
    }
    sendJson(res, 200, result);
  } catch (error) {
    console.error(error);
    sendJson(res, 400, { error: error.message || "Round setup failed." });
  }
}

function getFastLocalQuestionBank() {
  const now = Date.now();
  if (runtimeQuestionBankCache && runtimeQuestionBankCache.expiresAt > now) {
    return runtimeQuestionBankCache.questions;
  }

  // Local matches should not wait for optional persistent question sources.
  // The bundled bank is complete and is always available in the deployed app;
  // the normal runtime merge continues in the background for later rooms.
  if (!runtimeQuestionBankPromise) {
    void getRuntimeQuestionBank().catch((error) => {
      console.warn("Could not warm the dynamic question bank:", error.message || error);
    });
  }
  return questionBank;
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

function normalizeQuestionLanguage(language) {
  const value = String(language || "").trim();
  if (value === "zh-Hans" || value === "zh" || value === "zh-CN" || value === "chinese") {
    return "zh-Hans";
  }
  return "en";
}

function normalizeQuestionDebugBatch(value) {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
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
  const now = Date.now();
  if (runtimeQuestionBankCache && runtimeQuestionBankCache.expiresAt > now) {
    return runtimeQuestionBankCache.questions;
  }
  if (runtimeQuestionBankPromise) {
    return runtimeQuestionBankPromise;
  }

  runtimeQuestionBankPromise = (async () => {
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

    const questions = [...merged.values()];
    runtimeQuestionBankCache = {
      questions,
      expiresAt: Date.now() + runtimeQuestionBankCacheTtlMs
    };
    return questions;
  })();

  try {
    return await runtimeQuestionBankPromise;
  } finally {
    runtimeQuestionBankPromise = null;
  }
}

// Warm the shared bank during server startup so the first room does not pay
// the approved-question and override lookup cost on its critical path.
void getRuntimeQuestionBank().catch((error) => {
  console.warn("Could not warm the runtime question bank:", error?.message || error);
});

function normalizeSeedQuestion(question) {
  const source = question && typeof question === "object" ? question : {};
  const type = source.type === "image" ? "image" : "text";
  const questionStyle = source.questionStyle === "multiple-choice" || source.style === "multiple-choice" || source.type === "multiple-choice"
    ? "multiple-choice"
    : "standard";
  const language = normalizeQuestionLanguage(source.language || source.questionLanguage);
  const gradingStrictness = normalizeGradingStrictness(source.gradingStrictness);
  const debugBatch = normalizeQuestionDebugBatch(source.debugBatch);
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
    language,
    gradingStrictness,
    theme,
    difficulty: String(source.difficulty || "medium").trim().slice(0, 30),
    ...(debugBatch ? { debugBatch } : {}),
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
  if (normalized.includes("brutal")) {
    return 0.18;
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
  const questionLanguage = normalizeQuestionLanguage(options.questionLanguage || options.language);
  const preferredDifficulty = ["easy", "medium", "hard", "brutal"].includes(String(options.preferredDifficulty || ""))
    ? String(options.preferredDifficulty)
    : "";
  const preferredQuestionStyle = ["standard", "multiple-choice"].includes(String(options.preferredQuestionStyle || ""))
    ? String(options.preferredQuestionStyle)
    : "";
  const multipleChoiceChancePercent = getMultipleChoiceChancePercent(options.round, options.totalRounds);
  const runtimeQuestionBank = Array.isArray(options.runtimeQuestionBank)
    ? options.runtimeQuestionBank
    : await getRuntimeQuestionBank();
  const languagePool = runtimeQuestionBank.filter((question) => {
    const language = normalizeQuestionLanguage(question.language);
    return language === questionLanguage;
  });
  const preferredPool = preferredTheme
    ? languagePool.filter((question) => question.theme === preferredTheme && !isRepeatedQuestion(question.blackCard, recentBlackCards))
    : [];
  const broadPool = languagePool.filter((question) => enabledThemes.includes(question.theme) && !isRepeatedQuestion(question.blackCard, recentBlackCards));
  const fallbackPool = languagePool.filter((question) => enabledThemes.includes(question.theme));
  const themePool = preferredPool.length ? preferredPool : broadPool.length ? broadPool : fallbackPool;
  const difficultyPool = preferredDifficulty
    ? themePool.filter((question) => question.difficulty === preferredDifficulty)
    : themePool;
  const stylePool = preferredQuestionStyle
    ? difficultyPool.filter((question) => (question.questionStyle || "standard") === preferredQuestionStyle)
    : difficultyPool;
  const pool = stylePool.length ? stylePool : difficultyPool.length ? difficultyPool : themePool;
  if (!pool.length) {
    return null;
  }

  const multipleChoicePool = pool.filter(isMultipleChoiceQuestion);
  const standardPool = pool.filter((question) => !isMultipleChoiceQuestion(question));
  const wantsMultipleChoice = (multipleChoicePool.length && !standardPool.length)
    || (multipleChoicePool.length && (Math.abs(hashString(`${seed}-question-style`)) % 10000) / 100 < multipleChoiceChancePercent);
  const pickPool = wantsMultipleChoice
    ? multipleChoicePool
    : standardPool.length ? standardPool : pool;
  const picked = pickPool[Math.abs(hashString(seed)) % pickPool.length];
  const setup = {
    type: picked.type,
    questionStyle: picked.questionStyle || "standard",
    language: normalizeQuestionLanguage(picked.language),
    gradingStrictness: normalizeGradingStrictness(picked.gradingStrictness),
    theme: picked.theme,
    difficulty: picked.difficulty,
    blackCard: picked.blackCard,
    image: picked.image ? { ...picked.image } : { url: "", alt: "", credit: "" },
    canonicalAnswer: picked.canonicalAnswer,
    acceptedAnswers: picked.acceptedAnswers,
    rejectedAnswers: picked.rejectedAnswers || [],
    judge: getGenericJudge(),
    botCards: pickBotAnswersForSetup(picked, options.setupSeed),
    multipleChoiceOptions: isMultipleChoiceQuestion(picked)
      ? shuffleQuestionOptions(picked.multipleChoiceOptions, seed)
      : [],
    debug: {
      multipleChoiceChancePercent: Math.round(multipleChoiceChancePercent * 100) / 100,
      wantedMultipleChoice: Boolean(wantsMultipleChoice),
      languageOnlyMultipleChoice: Boolean(multipleChoicePool.length && !standardPool.length)
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
    .normalize("NFD")
    .toLowerCase()
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
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
    if (payload.gradingMode !== "mixed" && !hasAdminAuth(req)) {
      sendJson(res, 403, { error: "Admin authentication is required for grading debug modes." });
      return;
    }
    const cacheKey = createAiRoundCacheKey(payload);
    const cached = await getAiRoundCache(cacheKey);
    if (cached) {
      sendJson(res, 200, cached);
      return;
    }

    const localResult = createLocalRoundResult(payload);
    if (payload.gradingMode === "local") {
      const result = { ...localResult, gradingMode: "local" };
      setAiRoundCache(cacheKey, result);
      sendJson(res, 200, result);
      return;
    }

    if (payload.gradingMode === "force-ai") {
      const apiKey = getApiKey();
      if (!apiKey) {
        sendJson(res, 200, {
          ...localResult,
          gradingMode: "force-ai",
          source: "local-ai-unavailable",
          aiUnavailable: true
        });
        return;
      }

      try {
        const result = await rememberAiRoundResult(cacheKey, async () => {
          const modelResult = await generateRoundWithModel(payload, apiKey);
          return {
            ...modelResult,
            gradingMode: "force-ai",
            aiReviewedIndexes: getRoundAnswerEntries(payload, modelResult.cards).map((entry) => entry.index),
            aiSecondOpinionIndexes: []
          };
        });
        sendJson(res, 200, result);
        return;
      } catch (error) {
        console.warn("Forced AI grading failed, using local trivia grader:", error.message || error);
        sendJson(res, 200, {
          ...localResult,
          gradingMode: "force-ai",
          source: "local-ai-failed",
          aiUnavailable: true,
          aiError: error.message || "AI grading failed."
        });
        return;
      }
    }

    const secondOpinionCandidates = getAiSecondOpinionCandidates(payload, localResult);
    const apiKey = getApiKey();
    if (!secondOpinionCandidates.length) {
      const result = { ...localResult, gradingMode: "mixed" };
      setAiRoundCache(cacheKey, result);
      sendJson(res, 200, result);
      return;
    }
    if (!apiKey) {
      sendJson(res, 200, { ...localResult, gradingMode: "mixed" });
      return;
    }

    let result = { ...localResult, gradingMode: "mixed" };
    try {
      result = await rememberAiRoundResult(cacheKey, async () => {
        const secondOpinion = await generateRoundSecondOpinionWithModel(payload, apiKey, secondOpinionCandidates);
        return {
          ...mergeSecondOpinionRoundResult(localResult, secondOpinion, secondOpinionCandidates),
          gradingMode: "mixed"
        };
      });
    } catch (error) {
      console.warn("AI grading second opinion failed, using local trivia grader:", error.message || error);
      setAiRoundCache(cacheKey, result);
    }
    sendJson(res, 200, result);
  } catch (error) {
    console.error(error);
    sendJson(res, 400, { error: error.message || "Round grading failed." });
  }
}

async function handleDebugAiShield(req, res) {
  try {
    const body = await readRequestJson(req);
    const payload = normalizeRoundPayload({
      ...body,
      mode: "bots",
      gradingMode: "mixed",
      roundSeed: body.roundSeed || `debug-ai-shield-${Date.now()}`
    });
    const localResult = createLocalRoundResult(payload);
    const result = createAiSecondOpinionShieldResult(payload, localResult, {
      targetIndex: 0,
      treatAsBot: Boolean(body.treatAsBot)
    });
    sendJson(res, 200, result);
  } catch (error) {
    console.error(error);
    sendJson(res, 400, { error: error.message || "AI shield test failed." });
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
  const rejectedAnswers = Array.isArray(body.rejectedAnswers)
    ? body.rejectedAnswers.map((entry) => String(entry).trim().slice(0, 120)).filter(Boolean).slice(0, 12)
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
        answer: String(card?.answer || "").trim().slice(0, 140),
        bot: Boolean(card?.bot)
      }))
      .slice(0, 10)
    : [];
  const matchContext = body.matchContext && typeof body.matchContext === "object" ? body.matchContext : {};
  const roundSeed = String(body.roundSeed || `${Date.now()}-${Math.random()}`).slice(0, 80);
  const mode = body.mode === "local" ? "local" : body.mode === "room" ? "room" : "bots";
  const roomCode = String(body.roomCode || body.code || "").trim().toUpperCase().slice(0, 12);
  const participantId = String(body.participantId || "").trim().slice(0, 80);
  const gradingStrictness = normalizeGradingStrictness(body.gradingStrictness);
  const gradingMode = normalizeRoundGradingMode(body.gradingMode || body.debugGradingMode);

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
    rejectedAnswers,
    gradingStrictness,
    image,
    mode,
    roomCode,
    participantId,
    gradingMode,
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
    gradingMode: payload.gradingMode,
    roomCode: payload.roomCode,
    blackCard: payload.blackCard,
    triviaTheme: payload.triviaTheme,
    canonicalAnswer: payload.canonicalAnswer,
    acceptedAnswers: payload.acceptedAnswers,
    rejectedAnswers: payload.rejectedAnswers,
    gradingStrictness: payload.gradingStrictness,
    imageUrl: payload.image?.url || "",
    answer: payload.answer,
    opponentAnswer: payload.opponentAnswer,
    botCards: payload.botCards,
    debugRoundSeed: payload.gradingMode === "mixed" ? "" : payload.roundSeed,
    answerCards: payload.answerCards
      .map((card) => ({
        owner: card.owner,
        label: card.label,
        answer: card.answer,
        bot: card.bot
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
      "Be generous with widely used shorthand for names, apps, countries, games, organizations, and technical terms, such as 'yt' for YouTube, 'ig' for Instagram, 'js' for JavaScript, 'usa' for United States, and common all-caps acronyms.",
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
    task: "Grade candidate short trivia answers with the same context-aware acceptance standard as the full AI grader. The preset grader marked these incorrect, but that local result is only a cheap first pass and should not make you stricter.",
    outputShape: {
      correctIndexes: "array of candidate indexes that should be accepted as correct"
    },
    rules: [
      "Return only valid JSON. Do not wrap the JSON in markdown.",
      "Only evaluate candidateAnswers. Do not include any index that is not listed in candidateAnswers.",
      "Grade each candidate directly against the trivia question and the intended meaning of canonicalAnswer. Do not rely only on string similarity to canonicalAnswer or acceptedAnswers.",
      "Treat canonicalAnswer and acceptedAnswers as examples of the intended answer, not a complete list of every valid wording.",
      "Use the same acceptance standard as the full AI grader. If this answer would be accepted by a direct AI grading pass, include its index here.",
      "Do not be stricter just because the local preset grader rejected the answer. Your job is to correct local misses, not to defend them.",
      getGradingStrictnessInstruction(payload.gradingStrictness),
      "Accept an answer only when it clearly identifies the canonical answer despite misspelling, missing accents, phonetic spelling, abbreviation, alias, swapped word order, translation, or a distinctive partial answer.",
      "Be generous with broken spacing, extra articles, small filler words, typo-like splits or merges, and phonetic multi-word attempts when the intended answer is obvious from the question.",
      "If the stored answer is only part of a name or concept, accept a different identifying part, fuller name, common surname, title, alias, or equivalent phrase when the question context makes it clearly the same answer.",
      "A distinctive first name, surname, nickname, team name, title fragment, or object/place/company name can be correct when the question context makes the intended answer clear.",
      "Reject only when the answer is blank, nonsense, a broad category, a random related word, a guess that points to a different answer, generic filler, or too ambiguous to identify the intended answer.",
      "Blank, empty, nonsense, and gibberish answers are already filtered out and must not be accepted if present.",
      "If a meaningful answer points clearly to the right thing, accept it. Leave it out only when it could reasonably be a different answer or does not identify the answer.",
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
      temperature: 0.25,
      input: [
        {
          role: "system",
          content:
            "You grade short-answer trivia with the same acceptance standard as the full AI grader. The local preset grader is only a cheap first pass; overrule it when the question context makes the intended answer clear. Accept clear semantic equivalents, aliases, abbreviations, distinctive partial answers, broken spacing, and spelling or phonetic mistakes. Return only compact valid JSON."
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
      temperature: 0.25,
      messages: [
        {
          role: "system",
          content:
            "You grade short-answer trivia with the same acceptance standard as the full AI grader. The local preset grader is only a cheap first pass; overrule it when the question context makes the intended answer clear. Accept clear semantic equivalents, aliases, abbreviations, distinctive partial answers, broken spacing, and spelling or phonetic mistakes. Return only valid JSON with key correctIndexes."
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
  const rejectedAnswers = Array.isArray(payload.rejectedAnswers) ? payload.rejectedAnswers : [];
  const correctIndexes = cards
    .map((card, index) => ({ index, score: scoreAnswerAgainstBank(card, answerBank) }))
    .filter((entry) => (
      !isExplicitlyRejectedAnswer(cards[entry.index], rejectedAnswers)
      && isAnswerCorrectByStrictness(cards[entry.index], answerBank, payload.gradingStrictness)
    ))
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
      answer: cards[index] || card.answer || "",
      bot: Boolean(card.bot || /^bot\d*$/i.test(card.owner || ""))
    }));
  }
  if (payload.mode === "local") {
    return [
      { index: 0, label: "Player 1", answer: cards[0] || payload.answer || "", bot: false },
      { index: 1, label: "Player 2", answer: cards[1] || payload.opponentAnswer || "", bot: false }
    ];
  }
  const botLabels = Array.isArray(payload.botLabels) ? payload.botLabels : [];
  return cards.map((answer, index) => ({
    index,
    label: index === 0 ? "Player" : botLabels[index - 1] || `Bot ${index}`,
    answer,
    bot: index > 0
  }));
}

function isExplicitlyRejectedAnswer(answer, rejectedAnswers = []) {
  const normalized = normalizeTriviaAnswer(answer);
  if (!normalized || !Array.isArray(rejectedAnswers) || !rejectedAnswers.length) {
    return false;
  }
  const compact = normalized.replace(/\s+/g, "");
  return rejectedAnswers
    .map(normalizeTriviaAnswer)
    .filter(Boolean)
    .some((rejected) => normalized === rejected || compact === rejected.replace(/\s+/g, ""));
}

function getAiSecondOpinionCandidates(payload, localResult) {
  const answerBank = [payload.canonicalAnswer, ...payload.acceptedAnswers].filter(Boolean);
  if (!answerBank.length || !Array.isArray(localResult.cards)) {
    return [];
  }
  const alreadyCorrect = new Set(localResult.correctIndexes || []);
  const rejectedAnswers = Array.isArray(payload.rejectedAnswers) ? payload.rejectedAnswers : [];
  return getRoundAnswerEntries(payload, localResult.cards)
    .map((entry) => ({
      ...entry,
      score: scoreAnswerAgainstBank(entry.answer, answerBank)
    }))
    .filter((entry) => (
      !entry.bot
      && !alreadyCorrect.has(entry.index)
      && !isExplicitlyRejectedAnswer(entry.answer, rejectedAnswers)
      && shouldAskAiForSecondOpinion(entry.answer, answerBank, entry.score, payload.gradingStrictness, {
        question: payload.blackCard,
        theme: payload.triviaTheme,
        image: payload.image,
        mode: payload.mode
      })
    ))
    .slice(0, 4);
}

function createAiSecondOpinionShieldResult(payload, localResult, options = {}) {
  const answerBank = [payload.canonicalAnswer, ...payload.acceptedAnswers].filter(Boolean);
  const entries = getRoundAnswerEntries(payload, localResult.cards);
  const targetIndex = clampServerNumber(options.targetIndex, 0, Math.max(entries.length - 1, 0), 0);
  const baseEntry = entries[targetIndex] || {
    index: 0,
    label: "Player",
    answer: payload.answer || "",
    bot: false
  };
  const entry = {
    ...baseEntry,
    bot: Boolean(options.treatAsBot || baseEntry.bot)
  };
  const localScore = scoreAnswerAgainstBank(entry.answer, answerBank);
  const localThreshold = getLocalGradingThreshold(payload.gradingStrictness);
  const alreadyCorrect = Array.isArray(localResult.correctIndexes) && localResult.correctIndexes.includes(entry.index);
  const explicitlyRejected = isExplicitlyRejectedAnswer(entry.answer, payload.rejectedAnswers);
  let decision = null;

  if (!answerBank.length) {
    decision = {
      askAi: false,
      reasonCode: "missing-answer-bank",
      reason: "There is no saved answer to compare against, so mixed grading will not spend AI here."
    };
  } else if (entry.bot) {
    decision = {
      askAi: false,
      reasonCode: "bot-answer",
      reason: "Bot answers are skipped so AI tokens stay focused on real player answers."
    };
  } else if (alreadyCorrect) {
    decision = {
      askAi: false,
      reasonCode: "local-accepted",
      reason: "Local marking already accepts this answer, so no AI second look is needed."
    };
  } else if (explicitlyRejected) {
    decision = {
      askAi: false,
      reasonCode: "rejected-answer",
      reason: "This matches a saved rejected answer, so the AI shield blocks review."
    };
  } else {
    decision = getAiSecondOpinionShieldDecision(entry.answer, answerBank, localScore, payload.gradingStrictness, {
      question: payload.blackCard,
      theme: payload.triviaTheme,
      image: payload.image,
      mode: payload.mode
    });
  }

  return {
    gradingMode: "mixed",
    answer: entry.answer,
    answerIndex: entry.index,
    label: entry.label,
    normalizedAnswer: normalizeTriviaAnswer(entry.answer),
    strictness: normalizeGradingStrictness(payload.gradingStrictness),
    localScore: Number(localScore.toFixed(4)),
    localThreshold,
    localCorrect: alreadyCorrect,
    explicitlyRejected,
    treatAsBot: entry.bot,
    answerBank,
    aiConfigured: Boolean(getApiKey()),
    wouldAskAi: Boolean(decision.askAi),
    shield: decision.askAi ? "allows-ai-review" : "blocks-ai-review",
    reasonCode: decision.reasonCode,
    reason: decision.reason,
    details: decision.details || {}
  };
}

function shouldAskAiForSecondOpinion(answer, acceptedAnswers, localScore, strictness = "normal", context = {}) {
  return getAiSecondOpinionShieldDecision(answer, acceptedAnswers, localScore, strictness, context).askAi;
}

function getAiSecondOpinionShieldDecision(answer, acceptedAnswers, localScore, strictness = "normal", context = {}) {
  const normalizedStrictness = normalizeGradingStrictness(strictness);
  if (normalizedStrictness === "exact") {
    return {
      askAi: false,
      reasonCode: "exact-strictness",
      reason: "This question is set to Exact, so AI rescue is disabled."
    };
  }
  const normalized = normalizeTriviaAnswer(answer);
  const lowSignalReason = getLowSignalAnswerReason(normalized);
  if (lowSignalReason) {
    return {
      askAi: false,
      ...lowSignalReason
    };
  }
  const localThreshold = getLocalGradingThreshold(normalizedStrictness);
  if (localScore >= localThreshold) {
    return {
      askAi: false,
      reasonCode: "local-accepted",
      reason: "Local marking already accepts this answer, so no AI second look is needed.",
      details: {
        localScore,
        localThreshold
      }
    };
  }
  const scoreGate = normalizedStrictness === "forgiving" ? 0.34 : normalizedStrictness === "strict" ? 0.62 : 0.42;
  if (localScore >= scoreGate) {
    return {
      askAi: true,
      reasonCode: "near-local-match",
      reason: "This looks close enough to the saved answer for AI to take a second look.",
      details: {
        localScore,
        scoreGate
      }
    };
  }
  if (hasContextualAnswerReviewSignal(normalized, context, normalizedStrictness)) {
    return {
      askAi: true,
      reasonCode: "context-signal",
      reason: "This has enough real answer signal for AI to compare it against the question.",
      details: {
        localScore,
        scoreGate
      }
    };
  }
  const answerWords = normalized.split(" ").filter(Boolean);
  const normalizedAccepted = (Array.isArray(acceptedAnswers) ? acceptedAnswers : [])
    .map(normalizeTriviaAnswer)
    .filter(Boolean);
  const acceptedWords = normalizedAccepted
    .flatMap((entry) => entry.split(" ").filter((word) => word.length >= 4));
  if (!answerWords.length || !acceptedWords.length) {
    return {
      askAi: false,
      reasonCode: "too-little-signal",
      reason: "There is not enough useful answer text for AI review."
    };
  }
  const compactAnswer = normalized.replace(/\s+/g, "");
  const bestCompactScore = Math.max(0, ...normalizedAccepted.map((entry) => (
    scoreTriviaToken(compactAnswer, entry.replace(/\s+/g, ""))
  )));
  const compactGate = normalizedStrictness === "forgiving" ? 0.55 : normalizedStrictness === "strict" ? 0.78 : 0.62;
  if (bestCompactScore >= compactGate) {
    return {
      askAi: true,
      reasonCode: "spacing-near-match",
      reason: "The spacing or joined wording is close enough for AI to review.",
      details: {
        bestCompactScore,
        compactGate
      }
    };
  }
  const bestTokenScore = Math.max(0, ...answerWords.flatMap((answerWord) => (
    acceptedWords.map((acceptedWord) => scoreTriviaToken(answerWord, acceptedWord))
  )));
  const hasSharedDistinctiveWord = answerWords.some((word) => word.length >= 4 && acceptedWords.includes(word));
  const tokenGate = normalizedStrictness === "forgiving" ? 0.48 : normalizedStrictness === "strict" ? 0.72 : 0.55;
  if (hasSharedDistinctiveWord || bestTokenScore >= tokenGate) {
    return {
      askAi: true,
      reasonCode: hasSharedDistinctiveWord ? "shared-distinctive-word" : "token-near-match",
      reason: hasSharedDistinctiveWord
        ? "This shares a distinctive saved-answer word, so AI can review it."
        : "One important word is close enough for AI to review.",
      details: {
        bestTokenScore,
        tokenGate,
        hasSharedDistinctiveWord
      }
    };
  }
  return {
    askAi: false,
    reasonCode: "too-far-from-answer",
    reason: "This is too far from the saved answers and question context to spend AI.",
    details: {
      localScore,
      scoreGate,
      bestCompactScore,
      compactGate,
      bestTokenScore,
      tokenGate
    }
  };
}

function hasContextualAnswerReviewSignal(normalizedAnswer, context = {}, strictness = "normal") {
  if (!normalizedAnswer || normalizeGradingStrictness(strictness) === "exact") {
    return false;
  }
  const question = normalizeTriviaAnswer(context?.question || context?.blackCard || "");
  if (!question || question.length < 8) {
    return false;
  }
  const words = normalizedAnswer.split(" ").filter(Boolean);
  if (!words.length || words.length > 8) {
    return false;
  }
  const weakWords = new Set([
    "thing",
    "stuff",
    "someone",
    "somebody",
    "person",
    "people",
    "place",
    "artist",
    "painter",
    "singer",
    "actor",
    "movie",
    "song",
    "game",
    "book",
    "food",
    "animal",
    "country",
    "city",
    "maybe",
    "probably",
    "answer",
    "correct",
    "wrong"
  ]);
  const strongWords = words.filter((word) => (
    word.length >= 4
    && !weakWords.has(word)
    && !/^\d+$/.test(word)
  ));
  const hasNumber = words.some((word) => /^\d{1,4}$/.test(word));
  const hasMeaningfulPhrase = words.length >= 2 && words.some((word) => word.length >= 3);
  if (normalizeGradingStrictness(strictness) === "strict") {
    return strongWords.length >= 2 || (hasNumber && hasMeaningfulPhrase);
  }
  return strongWords.length >= 1 || hasNumber || hasMeaningfulPhrase;
}

function hasUsefulAnswerSignal(normalizedAnswer) {
  return !getLowSignalAnswerReason(normalizedAnswer);
}

function getLowSignalAnswerReason(normalizedAnswer) {
  if (!normalizedAnswer || normalizedAnswer.length < 3 || normalizedAnswer.length > 80) {
    return {
      reasonCode: !normalizedAnswer ? "blank-answer" : normalizedAnswer.length < 3 ? "too-short" : "too-long",
      reason: !normalizedAnswer
        ? "Blank answers never use AI."
        : normalizedAnswer.length < 3
          ? "This answer is too short for AI review."
          : "This answer is too long for the short-answer AI review path."
    };
  }
  const compact = normalizedAnswer.replace(/\s+/g, "");
  const nonsenseReason = getLikelyLowSignalNonsenseReason(normalizedAnswer);
  if (compact.length < 3 || /(.)\1{3,}/.test(compact) || nonsenseReason) {
    return {
      reasonCode: compact.length < 3 ? "too-short" : /(.)\1{3,}/.test(compact) ? "repeated-junk" : nonsenseReason.reasonCode,
      reason: compact.length < 3
        ? "This answer is too short for AI review."
        : /(.)\1{3,}/.test(compact)
          ? "This looks like repeated junk, so the AI shield blocks review."
          : nonsenseReason.reason
    };
  }
  if (lowSignalFillerAnswers.has(normalizedAnswer)) {
    return {
      reasonCode: "filler-answer",
      reason: "This is a filler answer, so the AI shield blocks review."
    };
  }
  const letters = compact.replace(/[^a-z]/g, "");
  if (letters.length >= 4 && !/[aeiouy]/.test(letters)) {
    return {
      reasonCode: "vowelless-junk",
      reason: "This does not look like a meaningful written answer, so the AI shield blocks review."
    };
  }
  if (!/[a-z0-9]/.test(compact)) {
    return {
      reasonCode: "no-answer-signal",
      reason: "This does not contain useful answer text for AI review."
    };
  }
  return null;
}

function isLikelyLowSignalNonsenseAnswer(normalizedAnswer) {
  return Boolean(getLikelyLowSignalNonsenseReason(normalizedAnswer));
}

function getLikelyLowSignalNonsenseReason(normalizedAnswer) {
  const compact = String(normalizedAnswer || "").replace(/\s+/g, "");
  const letters = compact.replace(/[^a-z]/g, "");
  if (letters.length < 8) {
    return null;
  }
  if (
    hasRepeatedNonsenseChunk(letters)
    || hasNearRepeatedNonsenseChunk(letters)
    || hasDominantRepeatedNgramPattern(letters)
    || hasRepetitiveFakeWordPattern(letters)
  ) {
    return {
      reasonCode: "repetitive-nonsense",
      reason: "This looks like repeated fake syllables, so the AI shield blocks review."
    };
  }
  if (hasKeyboardRowSequence(letters) || hasKeyboardWalkPattern(letters)) {
    return {
      reasonCode: "keyboard-mash",
      reason: "This looks like keyboard mashing, so the AI shield blocks review."
    };
  }
  if (hasUnnaturalLetterDistribution(letters)) {
    return {
      reasonCode: "low-signal-nonsense",
      reason: "This does not look like a meaningful written answer, so the AI shield blocks review."
    };
  }
  return null;
}

function hasRepeatedNonsenseChunk(letters) {
  for (let size = 2; size <= 4; size += 1) {
    if (letters.length >= size * 3 && letters.length % size === 0) {
      const chunk = letters.slice(0, size);
      if (chunk.repeat(letters.length / size) === letters) {
        return true;
      }
    }
  }
  return false;
}

function hasNearRepeatedNonsenseChunk(letters) {
  if (letters.length < 10) {
    return false;
  }
  const uniqueRatio = new Set(letters).size / Math.max(letters.length, 1);
  if (uniqueRatio > 0.58) {
    return false;
  }
  for (let size = 2; size <= 5; size += 1) {
    const chunk = letters.slice(0, size);
    if (new Set(chunk).size <= 1) {
      continue;
    }
    const repeated = chunk.repeat(Math.ceil(letters.length / size)).slice(0, letters.length);
    const similarity = 1 - (levenshteinDistance(letters, repeated) / Math.max(letters.length, 1));
    if (similarity >= 0.84) {
      return true;
    }
  }
  return false;
}

function hasDominantRepeatedNgramPattern(letters) {
  if (letters.length < 18) {
    return false;
  }
  const uniqueRatio = new Set(letters).size / Math.max(letters.length, 1);
  if (uniqueRatio > 0.38) {
    return false;
  }
  for (let size = 3; size <= 6; size += 1) {
    const counts = new Map();
    for (let index = 0; index <= letters.length - size; index += 1) {
      const gram = letters.slice(index, index + size);
      counts.set(gram, (counts.get(gram) || 0) + 1);
    }
    const highestCount = Math.max(0, ...counts.values());
    const coverage = (highestCount * size) / Math.max(letters.length, 1);
    if (highestCount >= 4 && coverage >= 0.52) {
      return true;
    }
  }
  return false;
}

function hasRepetitiveFakeWordPattern(letters) {
  if (letters.length < 12) {
    return false;
  }
  const uniqueRatio = new Set(letters).size / Math.max(letters.length, 1);
  const vowels = (letters.match(/[aeiouy]/g) || []).length;
  const vowelRatio = vowels / Math.max(letters.length, 1);
  const consonants = letters.replace(/[aeiouy]/g, "");
  if (uniqueRatio > 0.48 || vowelRatio < 0.58 || consonants.length < 3) {
    return false;
  }
  const consonantCounts = new Map();
  consonants.split("").forEach((letter) => {
    consonantCounts.set(letter, (consonantCounts.get(letter) || 0) + 1);
  });
  const dominantConsonantRatio = Math.max(0, ...consonantCounts.values()) / Math.max(consonants.length, 1);
  const repeatedVowelPairs = (letters.match(/[aeiouy]{2,}/g) || []).length;
  return dominantConsonantRatio >= 0.65 && repeatedVowelPairs >= 2;
}

function hasKeyboardRowSequence(letters) {
  return ["qwertyuiop", "asdfghjkl", "zxcvbnm"].some((row) => (
    hasKeyboardSlice(letters, row) || hasKeyboardSlice(letters, row.split("").reverse().join(""))
  ));
}

function hasKeyboardSlice(letters, row) {
  const minimumRun = 5;
  for (let size = minimumRun; size <= row.length; size += 1) {
    for (let index = 0; index <= row.length - size; index += 1) {
      if (letters.includes(row.slice(index, index + size))) {
        return true;
      }
    }
  }
  return false;
}

function hasKeyboardWalkPattern(letters) {
  if (letters.length < 8) {
    return false;
  }
  let keyboardPairs = 0;
  let longestWalk = 0;
  let currentWalk = 0;
  for (let index = 1; index < letters.length; index += 1) {
    if (isLooseKeyboardNeighbor(letters[index - 1], letters[index])) {
      keyboardPairs += 1;
      currentWalk += 1;
      longestWalk = Math.max(longestWalk, currentWalk);
    } else {
      currentWalk = 0;
    }
  }
  const ratio = keyboardPairs / Math.max(letters.length - 1, 1);
  const vowels = (letters.match(/[aeiouy]/g) || []).length;
  const vowelRatio = vowels / Math.max(letters.length, 1);
  return ratio >= 0.72 || (ratio >= 0.62 && longestWalk >= 4) || (ratio >= 0.58 && vowelRatio < 0.2);
}

function isLooseKeyboardNeighbor(left, right) {
  if (!left || !right || left === right) {
    return false;
  }
  const rows = ["qwertyuiop", "asdfghjkl", "zxcvbnm"];
  return rows.some((row) => {
    const leftIndex = row.indexOf(left);
    const rightIndex = row.indexOf(right);
    return leftIndex >= 0 && rightIndex >= 0 && Math.abs(leftIndex - rightIndex) <= 2;
  });
}

function hasUnnaturalLetterDistribution(letters) {
  const vowels = (letters.match(/[aeiouy]/g) || []).length;
  const vowelRatio = vowels / Math.max(letters.length, 1);
  const consonantRuns = letters.split(/[aeiouy]+/).map((chunk) => chunk.length);
  const longestConsonantRun = Math.max(0, ...consonantRuns);
  const longConsonantChunks = consonantRuns.filter((length) => length >= 4).length;
  const rareLetters = (letters.match(/[fjkqxz]/g) || []).length;
  const rareRatio = rareLetters / Math.max(letters.length, 1);

  if (letters.length >= 8 && vowelRatio <= 0.13 && longConsonantChunks >= 2) {
    return true;
  }
  if (letters.length >= 10 && vowelRatio < 0.18 && longestConsonantRun >= 5) {
    return true;
  }
  if (letters.length >= 12 && rareRatio >= 0.38 && vowelRatio < 0.25) {
    return true;
  }
  if (letters.length >= 14 && longestConsonantRun >= 5 && rareRatio >= 0.3) {
    return true;
  }
  return false;
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

    if (isKnownTriviaAbbreviation(normalizedAnswer, accepted)) {
      bestScore = Math.max(bestScore, 0.94);
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
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\b(the|a|an)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map(normalizeTriviaAnswerToken)
    .join(" ");
}

function getKnownTriviaAbbreviations(normalizedAccepted) {
  const aliases = new Set();
  const compactAccepted = String(normalizedAccepted || "").replace(/\s+/g, "");
  const directAliases = commonTriviaAbbreviationAliases.get(normalizedAccepted)
    || commonTriviaAbbreviationAliases.get(compactAccepted);
  (directAliases || []).forEach((alias) => aliases.add(normalizeTriviaAnswer(alias)));
  const acronym = createAcronym(normalizedAccepted);
  if (acronym && acronym.length >= 2) {
    aliases.add(acronym);
  }
  return [...aliases].filter(Boolean);
}

function isKnownTriviaAbbreviation(normalizedAnswer, normalizedAccepted) {
  if (!normalizedAnswer || !normalizedAccepted) {
    return false;
  }
  const aliases = getKnownTriviaAbbreviations(normalizedAccepted);
  return aliases.includes(normalizedAnswer);
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

function hasAdminAuth(req) {
  if (getAdminSession(req)) {
    return true;
  }

  const configuredToken = getAdminToken();
  const authorization = String(req.headers.authorization || "");
  const bearerToken = authorization.replace(/^Bearer\s+/i, "").trim();
  const headerToken = String(req.headers["x-admin-token"] || "").trim();
  return secureEqual(bearerToken, configuredToken) || secureEqual(headerToken, configuredToken);
}

function requireAdmin(req, res) {
  if (hasAdminAuth(req)) {
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
