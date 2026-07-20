const { createServer } = require("node:http");
const { readFile, stat, writeFile } = require("node:fs/promises");
const { createReadStream, existsSync, readFileSync } = require("node:fs");
const { extname, join, normalize } = require("node:path");
const { createHmac, timingSafeEqual } = require("node:crypto");
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
const adminCookieName = "cai_admin_session";
const adminSessionTtlSeconds = 60 * 60 * 12;
const maxRoomEvents = 100;
const roomRequestMaxBytes = 750_000;
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
      await handleGetUserInventory(url, res);
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
      await handleListOwnQuestionSubmissions(url, res);
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
      await handleListRooms(res);
      return;
    }

    if (url.pathname === "/api/rooms" && req.method === "PUT") {
      await handleUpsertRoom(req, res);
      return;
    }

    const roomGetMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)$/);
    if (roomGetMatch && req.method === "GET") {
      await handleGetRoom(res, roomGetMatch[1]);
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

    const roomPowerStateMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)\/power-state$/);
    if (roomPowerStateMatch && req.method === "POST") {
      await handleRoomPowerState(req, res, roomPowerStateMatch[1]);
      return;
    }

    const roomRoundSkipMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)\/round-skip$/);
    if (roomRoundSkipMatch && req.method === "POST") {
      await handleRoomRoundSkip(req, res, roomRoundSkipMatch[1]);
      return;
    }

    const roomEventsMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)\/events$/);
    if (roomEventsMatch && req.method === "GET") {
      await handleRoomEvents(url, res, roomEventsMatch[1]);
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

async function handleListRooms(res) {
  const rooms = (await listRoomsForDirectory())
    .filter((room) => room.status !== "complete")
    .sort((a, b) => b.updatedAt - a.updatedAt);
  sendJson(res, 200, { rooms });
}

async function handleGetRoom(res, code) {
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
  sendJson(res, 200, { room });
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
          host: Boolean(participant.host),
          spectator: Boolean(participant.spectator),
          active: Boolean(participant.active),
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
  sendJson(res, 200, { room: storedRoom });
}

async function handleImageProxy(url, res) {
  const source = String(url.searchParams.get("src") || "");
  if (!/^https:\/\/\S+$/i.test(source)) {
    sendText(res, 400, "Invalid image source");
    return;
  }

  try {
    const image = await fetchImageAsset(source, 14000);

    res.writeHead(200, {
      "Content-Type": image.contentType,
      "Cache-Control": "public, max-age=86400",
      "X-Content-Type-Options": "nosniff"
    });
    res.end(image.buffer);
  } catch {
    sendText(res, 502, "Image fetch failed");
  }
}

async function handleListOwnQuestionSubmissions(url, res) {
  const creatorId = String(url.searchParams.get("creatorId") || "").trim().slice(0, 120);
  if (!creatorId) {
    sendJson(res, 400, { error: "Missing creatorId." });
    return;
  }

  const submissions = (await backendStore.listQuestionSubmissions())
    .filter((submission) => submission.creator?.id === creatorId)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map(sanitizeQuestionSubmissionForCreator);
  sendJson(res, 200, { submissions });
}

async function handleCreateQuestionSubmission(req, res) {
  try {
    const body = await readRequestJson(req);
    const question = normalizeCreatedQuestion(body.question || body);
    const creator = body.creator && typeof body.creator === "object" ? body.creator : {};
    const creatorId = String(creator.id || "").trim().slice(0, 120);
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
    sendJson(res, 201, { submission: sanitizeQuestionSubmissionForCreator(storedSubmission) });
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

async function handleGetUserInventory(url, res) {
  const userId = normalizeInventoryUserId(url.searchParams.get("userId"));
  if (!userId) {
    sendJson(res, 400, { error: "Missing userId." });
    return;
  }

  const inventory = await getOrCreateUserInventory(userId);
  sendJson(res, 200, { inventory: sanitizeUserInventoryForClient(inventory) });
}

async function handleUserInventoryOps(req, res) {
  try {
    const body = await readRequestJson(req, { maxBytes: 500_000 });
    const userId = normalizeInventoryUserId(body.userId);
    if (!userId) {
      sendJson(res, 400, { error: "Missing userId." });
      return;
    }

    const ops = Array.isArray(body.ops) ? body.ops.slice(0, 100) : [];
    if (!ops.length) {
      const inventory = await getOrCreateUserInventory(userId);
      sendJson(res, 200, { inventory: sanitizeUserInventoryForClient(inventory), applied: [], skipped: [] });
      return;
    }

    const inventory = await getOrCreateUserInventory(userId);
    const applied = [];
    const skipped = [];
    ops.forEach((op) => {
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
      skipped
    });
  } catch (error) {
    sendJson(res, 400, { error: error.message || "Inventory update failed." });
  }
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
    const delta = clampInventoryDelta(op.delta);
    if (!delta) {
      return { applied: false, id, reason: "empty-delta" };
    }
    if (inventory.coins + delta < 0) {
      return { applied: false, id, reason: "insufficient-coins" };
    }
    applyCoinTransaction(inventory, id, delta, op.reason || "adjustment", now);
    applied = true;
  } else if (type === "purchase-cosmetic") {
    const key = normalizeInventoryKey(op.key);
    const cost = Math.max(0, Math.floor(Number(op.cost) || 0));
    if (!key) {
      return { applied: false, id, reason: "missing-cosmetic" };
    }
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
    if (!inventory.claimedMilestones.includes(milestoneId)) {
      inventory.claimedMilestones.push(milestoneId);
      const coinDelta = clampInventoryDelta(op.coinDelta);
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
    easy: 0,
    medium: 0,
    hard: 0
  }]));

  runtimeQuestionBank.forEach((question) => {
    const bucket = counts[question.theme] || (counts[question.theme] = {
      total: 0,
      image: 0,
      text: 0,
      easy: 0,
      medium: 0,
      hard: 0
    });
    bucket.total += 1;
    bucket[question.type] = (bucket[question.type] || 0) + 1;
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
      theme: question.theme,
      difficulty: question.difficulty,
      question: question.blackCard,
      image: question.image,
      canonicalAnswer: question.canonicalAnswer,
      acceptedAnswers: question.acceptedAnswers,
      botCards: question.botCards,
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
  const question = String(source.question || "").trim().replace(/\s+/g, " ").slice(0, 260);
  const canonicalAnswer = String(source.canonicalAnswer || "").trim().slice(0, 120);
  if (!question || !canonicalAnswer) {
    throw new Error("Question text and canonical answer are required.");
  }

  const acceptedAnswers = normalizeAnswerList(source.acceptedAnswers, 16);
  const botCards = normalizeAnswerList(source.botCards, 2);
  if (botCards.length !== 2) {
    throw new Error("Enter exactly two bot answers.");
  }

  const created = {
    id,
    type,
    theme,
    difficulty,
    question,
    canonicalAnswer,
    acceptedAnswers: uniqueAnswers(acceptedAnswers).slice(0, 16),
    botCards
  };

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

async function handleUpsertRoom(req, res) {
  try {
    const body = await readRequestJson(req, { maxBytes: roomRequestMaxBytes });
    const rawRoom = body.room || body;
    const existingRoom = await backendStore.getRoom(rawRoom.code);
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
    stampRoomEvent(room, existingRoom ? "room_updated" : "room_created", { status: room.status });
    const storedRoom = await backendStore.upsertRoom(room);
    sendJson(res, 200, { room: storedRoom });
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

function hasActiveRealPlayers(room) {
  return Array.isArray(room?.participants)
    && room.participants.some((participant) => participant.active && !participant.bot && !participant.spectator);
}

function getRoomActivePlayerCount(room) {
  if (Array.isArray(room?.participants) && room.participants.length) {
    return room.participants.filter((participant) => participant.active !== false && !participant.spectator).length;
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

async function listRoomsForDirectory() {
  return backendStore.listRooms();
}

async function handleRoomPresence(req, res, code) {
  try {
    const normalizedCode = String(code || "").trim().toUpperCase();
    const room = await backendStore.getRoom(normalizedCode);
    if (!room) {
      sendJson(res, 404, { error: "Room not found." });
      return;
    }

    const body = await readRequestJson(req, { maxBytes: roomRequestMaxBytes });
    const rawParticipant = body.participant || {};
    const participant = normalizeParticipant(rawParticipant);
    const existingIndex = room.participants.findIndex((entry) => entry.id === participant.id);
    if (existingIndex >= 0) {
      const existingParticipant = room.participants[existingIndex];
      room.participants[existingIndex] = {
        ...existingParticipant,
        ...participant,
        answer: Object.hasOwn(rawParticipant, "answer") ? participant.answer : existingParticipant.answer,
        submittedRound: Object.hasOwn(rawParticipant, "submittedRound") ? participant.submittedRound : existingParticipant.submittedRound,
        remainingTime: Object.hasOwn(rawParticipant, "remainingTime") ? participant.remainingTime : existingParticipant.remainingTime
      };
    } else {
      room.participants.push(participant);
    }

    if (participant.host) {
      room.host = {
        ...(room.host || {}),
        id: participant.id,
        name: participant.name,
        avatar: participant.avatar,
        equippedTitleId: participant.equippedTitleId || "",
        specialBadges: normalizeSpecialBadges(participant.specialBadges),
        cardCustomization: participant.cardCustomization || null
      };
    }
    if (participant.host || participant.id === room.host?.id) {
      room.hostExitPendingAt = 0;
    }
    finalizeRoom(room);
    stampRoomEvent(room, existingIndex >= 0 ? "participant_updated" : "participant_joined", {
      participantId: participant.id,
      host: Boolean(participant.host),
      spectator: Boolean(participant.spectator),
      status: participant.status,
      participant: room.participants.find((entry) => entry.id === participant.id) || participant
    });
    const storedRoom = await backendStore.upsertRoom(room);
    if (body.compact) {
      const storedParticipant = storedRoom.participants.find((entry) => entry.id === participant.id) || participant;
      sendJson(res, 200, {
        code: storedRoom.code,
        status: storedRoom.status,
        revision: getRoomRevision(storedRoom),
        updatedAt: storedRoom.updatedAt,
        participant: storedParticipant
      });
      return;
    }
    sendJson(res, 200, { room: storedRoom });
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
    if (!isHostParticipant(room, body.hostParticipantId)) {
      sendJson(res, 403, { error: "Only the host can update room settings." });
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
        name: String(body.host.name || room.host?.name || "Host").slice(0, 24),
        avatar: String(body.host.avatar || room.host?.avatar || "").slice(0, 60000),
        equippedTitleId: String(body.host.equippedTitleId || room.host?.equippedTitleId || "").slice(0, 80),
        specialBadges: normalizeSpecialBadges(body.host.specialBadges || room.host?.specialBadges),
        cardCustomization: normalizeCardCustomization(body.host.cardCustomization || room.host?.cardCustomization)
      };
      const hostParticipant = room.participants.find((participant) => participant.id === room.host.id || participant.host);
      if (hostParticipant) {
        hostParticipant.name = room.host.name;
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
    sendJson(res, 200, {
      code: storedRoom.code,
      status: storedRoom.status,
      revision: getRoomRevision(storedRoom),
      updatedAt: storedRoom.updatedAt,
      settings: storedRoom.settings,
      host: storedRoom.host
    });
  } catch (error) {
    sendJson(res, 400, { error: error.message || "Room settings update failed." });
  }
}

async function handleRoomHeartbeat(req, res, code) {
  try {
    const normalizedCode = String(code || "").trim().toUpperCase();
    const room = await backendStore.getRoom(normalizedCode);
    if (!room) {
      sendJson(res, 404, { error: "Room not found." });
      return;
    }

    const body = await readRequestJson(req);
    const participantId = String(body.participantId || "").slice(0, 80);
    const participant = room.participants.find((entry) => entry.id === participantId);
    const isHostHeartbeat = participantId && (participantId === room.host?.id || participant?.host);
    if (!isHostHeartbeat) {
      sendJson(res, 403, { error: "Only the host can heartbeat this room." });
      return;
    }

    room.hostExitPendingAt = 0;
    if (participant) {
      participant.active = true;
      participant.status = String(body.status || participant.status || "host").slice(0, 32);
    }
    finalizeRoom(room);
    room.updatedAt = Date.now();
    const storedRoom = await backendStore.upsertRoom(room);
    sendJson(res, 200, { room: storedRoom });
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
    room.chat = normalizeRoomChat([...(Array.isArray(room.chat) ? room.chat : []), message]);
    stampRoomEvent(room, "chat_message", {
      owner: message.owner,
      sender: message.sender,
      private: Boolean(message.private),
      message
    });
    finalizeRoom(room);
    const storedRoom = await backendStore.upsertRoom(room);
    if (body.compact) {
      sendJson(res, 200, {
        code: storedRoom.code,
        status: storedRoom.status,
        revision: getRoomRevision(storedRoom),
        updatedAt: storedRoom.updatedAt,
        message
      });
      return;
    }
    sendJson(res, 200, { room: storedRoom, message });
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
    const game = normalizeRoomGame(body.game || body);
    if (!game || (!game.setup && game.status !== "ended")) {
      sendJson(res, 400, { error: "Room game update needs a setup payload." });
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
    sendJson(res, 200, { room: storedRoom });
  } catch (error) {
    sendJson(res, 400, { error: error.message || "Room game update failed." });
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
    const powerState = normalizeRoomPowerState({
      updatedAt: Date.now(),
      hands: body.hands,
      played: body.played,
      players: body.players,
      effects: body.effects
    });
    if (!powerState) {
      sendJson(res, 400, { error: "Room power update needs a power state payload." });
      return;
    }
    const mergedPowerState = mergeRoomPowerState(room.game?.powerState, powerState);
    if (!room.game || typeof room.game !== "object") {
      room.game = {
        matchId: `${normalizedCode}-${Date.now()}`,
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
    stampRoomEvent(room, "power_state", {
      round: clampServerNumber(body.round, 0, 100, room.game.round || 0),
      powerId: String(body.powerId || "").slice(0, 80),
      actorParticipantId: String(body.actorParticipantId || "").slice(0, 120),
      targetParticipantId: String(body.targetParticipantId || "").slice(0, 120),
      deletedPowerId: String(body.deletedPowerId || "").slice(0, 80),
      stolenPowerId: String(body.stolenPowerId || "").slice(0, 80),
      powerState
    });
    finalizeRoom(room);
    const storedRoom = await backendStore.upsertRoom(room);
    sendJson(res, 200, {
      code: storedRoom.code,
      status: storedRoom.status,
      revision: getRoomRevision(storedRoom),
      updatedAt: storedRoom.updatedAt,
      round: clampServerNumber(body.round, 0, 100, storedRoom.game?.round || 0),
      powerId: String(body.powerId || "").slice(0, 80),
      actorParticipantId: String(body.actorParticipantId || "").slice(0, 120),
      targetParticipantId: String(body.targetParticipantId || "").slice(0, 120),
      deletedPowerId: String(body.deletedPowerId || "").slice(0, 80),
      stolenPowerId: String(body.stolenPowerId || "").slice(0, 80),
      hands: powerState.hands,
      played: powerState.played,
      players: powerState.players,
      effects: powerState.effects
    });
  } catch (error) {
    sendJson(res, 400, { error: error.message || "Room power update failed." });
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
        remainingTime: clampServerNumber(source.remainingTime, 0, 600, 0)
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
    if (!isHostParticipant(room, hostParticipantId)) {
      sendJson(res, 403, { error: "Only the host can skip to grading." });
      return;
    }

    const round = clampServerNumber(body.round, 1, 100, room.game?.round || 1);
    const submissions = normalizeRoundSkipSubmissions(body.submissions);
    submissions.forEach((submission) => {
      const participant = room.participants.find((entry) => entry.id === submission.participantId);
      if (!participant || participant.active === false || participant.spectator) {
        return;
      }
      participant.answer = submission.answer;
      participant.submittedRound = round;
      participant.remainingTime = submission.remainingTime;
      participant.status = "submitted";
    });

    stampRoomEvent(room, "round_skipped", {
      round,
      hostParticipantId,
      submissions,
      reason: String(body.reason || "host-skip").slice(0, 60)
    });
    finalizeRoom(room);
    const storedRoom = await backendStore.upsertRoom(room);
    sendJson(res, 200, {
      code: storedRoom.code,
      status: storedRoom.status,
      revision: getRoomRevision(storedRoom),
      updatedAt: storedRoom.updatedAt,
      round,
      hostParticipantId,
      submissions,
      reason: String(body.reason || "host-skip").slice(0, 60)
    });
  } catch (error) {
    sendJson(res, 400, { error: error.message || "Round skip failed." });
  }
}

async function handleRoomEvents(url, res, code) {
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
  const events = normalizeRoomEvents(room.events).filter((event) => event.revision > since);
  sendJson(res, 200, {
    code: room.code,
    revision: getRoomRevision(room),
    events
  });
}

function isHostParticipant(room, participantId) {
  const id = String(participantId || "").slice(0, 80);
  return Boolean(id && (id === room.host?.id || room.participants.some((participant) => participant.id === id && participant.host)));
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
    if (!isHostParticipant(room, hostParticipantId)) {
      sendJson(res, 403, { error: "Only the host can moderate this room." });
      return;
    }

    const action = String(body.action || "").slice(0, 32);
    const participantId = String(body.participantId || "").slice(0, 80);
    const participant = room.participants.find((entry) => entry.id === participantId);
    if (!participant || participant.host || participant.id === room.host?.id) {
      sendJson(res, 404, { error: "Participant not found." });
      return;
    }

    if (action === "mute" || action === "unmute" || action === "set-muted") {
      const muted = action === "mute" ? true : action === "unmute" ? false : Boolean(body.muted);
      participant.muted = muted;
      participant.status = muted ? "muted" : String(participant.status || "joined").slice(0, 32);
    } else if (action === "kick" || action === "ban") {
      participant.active = false;
      participant.status = action === "ban" ? "banned" : "kicked";
      if (action === "ban") {
        room.banned = [...new Set([...(Array.isArray(room.banned) ? room.banned : []), participant.id, participant.name].filter(Boolean))];
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
    sendJson(res, 200, {
      code: storedRoom.code,
      status: storedRoom.status,
      revision: getRoomRevision(storedRoom),
      updatedAt: storedRoom.updatedAt,
      action,
      participantId,
      participant: storedParticipant,
      banned: storedRoom.banned || []
    });
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
    if (!isHostParticipant(room, participantId)) {
      sendJson(res, 403, { error: "Only the host can close this room." });
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
      id: String(host.id || participants.find((entry) => entry.host)?.id || "host").slice(0, 80),
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
    hostExitPendingAt: 0,
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
    autoAdvance: source.autoAdvance !== false,
    private: Boolean(source.private),
    password: String(source.password || "").slice(0, 32),
    enabledThemes: normalizeEnabledThemes(source.enabledThemes),
    code: String(code || source.code || "").trim().toUpperCase()
  };
}

function normalizeParticipant(participant) {
  const id = String(participant.id || "").slice(0, 80);
  if (!id) {
    throw new Error("Missing participant id.");
  }

  return {
    id,
    name: String(participant.name || "Guest").slice(0, 24),
    avatar: String(participant.avatar || "").slice(0, 60000),
    equippedTitleId: String(participant.equippedTitleId || "").slice(0, 80),
    specialBadges: normalizeSpecialBadges(participant.specialBadges),
    cardCustomization: normalizeCardCustomization(participant.cardCustomization),
    host: Boolean(participant.host),
    spectator: Boolean(participant.spectator),
    bot: Boolean(participant.bot),
    active: participant.active !== false,
    muted: Boolean(participant.muted),
    status: String(participant.status || (participant.bot ? "bot" : participant.spectator ? "spectating" : "ready")).slice(0, 32),
    answer: String(participant.answer || "").slice(0, 500),
    submittedRound: clampServerNumber(participant.submittedRound, 0, 100, 0),
    remainingTime: clampServerNumber(participant.remainingTime, 0, 600, 0)
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
      await closeStoredRoom(normalizedCode, "host-left");
      sendJson(res, 200, { closed: true, code: normalizedCode, reason: "host-left" });
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
    sendJson(res, 200, { room: storedRoom, participant: leavingParticipant, closed: false });
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
        host: Boolean(source.host),
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

  return {
    matchId: String(game.matchId || "").slice(0, 80),
    status: String(game.status || "playing").slice(0, 32),
    round: clampServerNumber(game.round, 1, 100, 1),
    setup,
    powerState: normalizeRoomPowerState(game.powerState),
    updatedAt: clampServerNumber(game.updatedAt, 0, Number.MAX_SAFE_INTEGER, Date.now())
  };
}

function normalizeRoomPowerState(powerState) {
  if (!powerState || typeof powerState !== "object") {
    return null;
  }
  const hands = Array.isArray(powerState.hands) ? powerState.hands : [];
  return {
    updatedAt: clampServerNumber(powerState.updatedAt, 0, Number.MAX_SAFE_INTEGER, Date.now()),
    hands: hands
      .map((entry) => {
        const source = entry && typeof entry === "object" ? entry : {};
        return {
          participantId: String(source.participantId || "").slice(0, 120),
          owner: String(source.owner || "").slice(0, 80),
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
          score: clampServerNumber(source.score, 0, Number.MAX_SAFE_INTEGER, 0),
          streak: clampServerNumber(source.streak, 0, Number.MAX_SAFE_INTEGER, 0)
        };
      })
      .filter((entry) => entry.participantId)
      .slice(0, 10),
    effects: normalizeRoomAbilityEffects(powerState.effects)
  };
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
      byParticipantId.set(entry.participantId, entry);
    }
  });
  return [...byParticipantId.values()].slice(0, 10);
}

function mergeRoomPowerState(previousPowerState, nextPowerState) {
  const previous = normalizeRoomPowerState(previousPowerState) || {
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
  const participantById = new Map();
  room.participants.forEach((participant) => {
    if (!room.banned.includes(participant.id) && !room.banned.includes(participant.name)) {
      participantById.set(participant.id, participant);
    }
  });
  room.participants = [...participantById.values()];
  const activeHosts = room.participants.filter((participant) => participant.host && participant.active !== false && !participant.spectator);
  if (activeHosts.length > 1) {
    const preferredHost = activeHosts.find((participant) => participant.id === room.host?.id) || activeHosts.at(-1);
    const staleHostIds = new Set(activeHosts.filter((participant) => participant.id !== preferredHost.id).map((participant) => participant.id));
    room.participants = room.participants.filter((participant) => !staleHostIds.has(participant.id));
  }
  if (!room.participants.some((participant) => participant.host)) {
    room.participants.unshift({
      id: room.host.id,
      name: room.host.name,
      avatar: room.host.avatar,
      equippedTitleId: room.host.equippedTitleId || "",
      specialBadges: normalizeSpecialBadges(room.host.specialBadges),
      cardCustomization: room.host.cardCustomization || null,
      host: true,
      spectator: false,
      bot: false,
      active: room.status !== "complete",
      muted: false,
      status: "host",
      answer: "",
      submittedRound: 0,
      remainingTime: 0
    });
  }
  room.activePlayers = room.participants.filter((participant) => participant.active && !participant.spectator).length;
  room.spectators = room.participants.filter((participant) => participant.active && participant.spectator).length;
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

  if (!filePath.startsWith(root)) {
    sendText(res, 403, "Forbidden");
    return;
  }

  try {
    const fileStats = await stat(filePath);
    if (!fileStats.isFile()) {
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
    sendText(res, 404, "Not found");
  }
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
    return "public, max-age=3600, stale-while-revalidate=86400";
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
    const result = await getSeedQuestionSetup({
      recentBlackCards,
      enabledThemes,
      preferredTheme,
      setupSeed: baseSeed,
      backgroundMode
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
  const theme = triviaThemes.includes(source.theme) ? source.theme : "Pop Culture";
  const blackCard = String(source.question || source.blackCard || "").trim().replace(/\s+/g, " ").slice(0, 220);
  const canonicalAnswer = String(source.canonicalAnswer || "").trim().slice(0, 120);
  if (!blackCard || !canonicalAnswer) {
    return null;
  }

  const acceptedAnswers = Array.isArray(source.acceptedAnswers)
    ? source.acceptedAnswers.map((answer) => String(answer).trim().slice(0, 120)).filter(Boolean)
    : [];
  const botCards = normalizeBotCards(source.botCards);
  const botCorrectPool = uniqueAnswers([canonicalAnswer, ...acceptedAnswers]);
  const botWrongPool = uniqueAnswers(botCards).filter((answer) => {
    const accepted = [canonicalAnswer, ...acceptedAnswers].filter(Boolean);
    return scoreAnswerAgainstBank(answer, accepted) < 0.82;
  });
  const botAnswerPool = uniqueAnswers([
    ...botCorrectPool,
    ...(botWrongPool.length ? botWrongPool : botCards)
  ]);
  const image = source.image && typeof source.image === "object" ? source.image : {};

  return {
    id: String(source.id || `${theme}-${canonicalAnswer}`).trim().slice(0, 120),
    type,
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
    botCards: botCards.length === 2 ? botCards : createFallbackBotCards(canonicalAnswer),
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
  const correctPool = uniqueAnswers(
    Array.isArray(question.botCorrectPool) && question.botCorrectPool.length
      ? question.botCorrectPool
      : [question.canonicalAnswer, ...(question.acceptedAnswers || [])]
  );
  const wrongPool = uniqueAnswers(
    Array.isArray(question.botWrongPool) && question.botWrongPool.length
      ? question.botWrongPool
      : question.botCards || []
  ).filter((answer) => scoreAnswerAgainstBank(answer, correctPool) < 0.82);
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

async function getSeedQuestionSetup(options = {}) {
  const enabledThemes = normalizeEnabledThemes(options.enabledThemes);
  const preferredTheme = normalizePreferredTheme(options.preferredTheme, enabledThemes);
  const recentBlackCards = Array.isArray(options.recentBlackCards) ? options.recentBlackCards : [];
  const seed = String(options.setupSeed || `${Date.now()}-${Math.random()}`);
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

  const picked = pool[Math.abs(hashString(seed)) % pool.length];
  const setup = {
    type: picked.type,
    theme: picked.theme,
    difficulty: picked.difficulty,
    blackCard: picked.blackCard,
    image: picked.image ? { ...picked.image } : { url: "", alt: "", credit: "" },
    canonicalAnswer: picked.canonicalAnswer,
    acceptedAnswers: picked.acceptedAnswers,
    judge: getGenericJudge(),
    botCards: pickBotAnswersForSetup(picked, options.setupSeed),
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
  const apiKey = getApiKey();
  if (!apiKey) {
    sendJson(res, 503, { error: "AI_API_KEY, COMPUTINGER_API_KEY, or OPENAI_API_KEY is not configured." });
    return;
  }

  try {
    const body = await readRequestJson(req);
    const payload = normalizeRoundPayload(body);
    let result;
    try {
      result = await generateRoundWithModel(payload, apiKey);
    } catch (error) {
      console.warn("AI round grading failed, using local trivia grader:", error.message || error);
      result = createLocalRoundResult(payload);
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
  const botCards = Array.isArray(body.botCards) ? body.botCards.map((card) => String(card).trim().slice(0, 140)).filter(Boolean).slice(0, 2) : [];
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
    image,
    mode,
    botCards,
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
      : payload.botCards.length === 2
        ? "Grade the player's short trivia answer exactly as typed and keep the two pre-generated bot guesses exactly as provided."
        : "Grade the player's short trivia answer exactly as typed and create two plausible competing bot guesses.",
    outputShape: {
      cards: submittedAnswers.map((entry) => `${entry.label} answer`),
      winnerIndex: `internal scoring index from 0 to ${Math.max(0, submittedAnswers.length - 1)}`,
      correctIndexes: "array of every answer index that should be accepted as correct"
    },
    rules: [
      "Return only valid JSON. Do not wrap the JSON in markdown.",
      "Use submittedAnswers as the source of truth for every player/bot response. These answers are present and must be graded.",
      "Grade answers against the question and the intended meaning of canonicalAnswer. Treat acceptedAnswers as optional examples, not as the complete list of all valid answers.",
      "Blank or empty answers are always incorrect and must never appear in correctIndexes.",
      "Use general trivia knowledge to accept semantically equivalent answers even when they are not listed in acceptedAnswers.",
      "Accept common aliases, nicknames, abbreviations, acronyms, translations, alternate spellings, swapped word order, missing accents, and minor spelling mistakes when the intended answer is clearly correct.",
      "Accept a distinctive partial answer when it clearly identifies the same thing as the canonical answer. This applies to all question types: people, places, teams, titles, objects, events, concepts, companies, artworks, games, and media. Do not require the full preset answer when the player gave enough information to identify it.",
      "Reject answers that are only a broad category, a generic adjective, a random related word, or too ambiguous to identify the canonical answer.",
      "Every cards[index] value must exactly match submittedAnswers[index].answer with no added words, flavor text, punctuation, or rewrite.",
      isRoom
        ? "Do not generate any extra bot guesses in room mode; only grade the submitted room answers."
        : isLocal
        ? "cards[1] must be exactly Player 2's raw answer with no added words, flavor text, punctuation, or rewrite."
        : payload.botCards.length === 2
          ? "cards[1] and cards[2] must exactly match the provided botCards in order. Do not rewrite or replace them."
          : "Generate cards[1] and cards[2] as short plausible trivia guesses. At least one bot guess may be wrong, but both should look like real quiz answers.",
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
        : payload.botCards.length === 2
          ? "Use the provided bot cards as the bot competition."
          : "The two bot cards must be independent plausible guesses, not derived from the player's raw answer.",
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
  return payload.mode === "local" ? 2 : 3;
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
            "You grade a short-answer trivia quiz. Accepted answer lists are examples, not exhaustive. Accept clear semantic equivalents, aliases, abbreviations, partial-but-identifying answers, missing accents, and minor spelling mistakes. Return only compact valid JSON matching the schema."
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
            "You grade a short-answer trivia quiz. Accepted answer lists are examples, not exhaustive. Accept clear semantic equivalents, aliases, abbreviations, partial-but-identifying answers, missing accents, and minor spelling mistakes. Return only valid JSON with keys cards, winnerIndex, and correctIndexes."
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
    : [payload.answer, ...normalizeBotCards(payload.botCards)];
  const answerBank = [payload.canonicalAnswer, ...payload.acceptedAnswers].filter(Boolean);
  const correctIndexes = cards
    .map((card, index) => ({ index, score: scoreAnswerAgainstBank(card, answerBank) }))
    .filter((entry) => entry.score >= 0.82)
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.index)
    .filter((index) => index >= 0 && index < expectedCards);
  const winnerIndex = correctIndexes[0] ?? 0;

  return {
    cards: cards.slice(0, expectedCards),
    winnerIndex,
    correctIndexes: [...new Set(correctIndexes)],
    source: "local-fallback"
  };
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
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(the|a|an)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function createAcronym(value) {
  return String(value || "")
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word[0])
    .join("");
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
      : payload.botCards.length === 2
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
    .filter((entry) => entry.score >= 0.82)
    .map((entry) => entry.index);
  const correctIndexes = [...new Set([...modelCorrectIndexes, ...localCorrectIndexes])];
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

async function fetchImageAsset(source, timeoutMs = 5000) {
  const cached = imageCache.get(source);
  if (cached && cached.expiresAt > Date.now()) {
    return cached;
  }

  const response = await fetchWithTimeout(source, {
    headers: {
      Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36"
    }
  }, timeoutMs);
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
    expiresAt: Date.now() + imageCacheTtlMs
  };
  imageCache.set(source, image);
  return image;
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

function normalizeBotCards(cards) {
  const normalized = Array.isArray(cards) ? cards.map((card) => String(card).trim().slice(0, 140)).filter(Boolean).slice(0, 2) : [];
  const fallbacks = [
    "I don't know",
    "Maybe Paris"
  ];

  while (normalized.length < 2) {
    normalized.push(fallbacks[normalized.length]);
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

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(payload));
}

function sendText(res, status, message) {
  res.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(message);
}
