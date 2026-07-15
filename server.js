const { createServer } = require("node:http");
const { readFile, writeFile } = require("node:fs/promises");
const { existsSync, readFileSync } = require("node:fs");
const { extname, join, normalize } = require("node:path");
const { createHmac, timingSafeEqual } = require("node:crypto");
const { createBackendStore } = require("./lib/backend-store");

const root = __dirname;
loadEnv();
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "127.0.0.1";
const backendStore = createBackendStore({
  roomTtlSeconds: process.env.ROOM_TTL_SECONDS || 60 * 60 * 6
});
const hostExitGraceMs = Number(process.env.HOST_EXIT_GRACE_SECONDS || 30) * 1000;
const imageCache = new Map();
const imageCacheTtlMs = 15 * 60 * 1000;
const adminCookieName = "cai_admin_session";
const adminSessionTtlSeconds = 60 * 60 * 12;
const maxRoomEvents = 100;
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

    const roomPresenceMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)\/presence$/);
    if (roomPresenceMatch && req.method === "POST") {
      await handleRoomPresence(req, res, roomPresenceMatch[1]);
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

    const roomEventsMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)\/events$/);
    if (roomEventsMatch && req.method === "GET") {
      await handleRoomEvents(url, res, roomEventsMatch[1]);
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
  const rooms = (await listRoomsWithHostExitPrune())
    .filter((room) => room.status !== "complete")
    .sort((a, b) => b.updatedAt - a.updatedAt);
  sendJson(res, 200, { rooms });
}

async function handleAdminStatus(req, res) {
  if (!requireAdmin(req, res)) {
    return;
  }

  const rooms = await listRoomsWithHostExitPrune();
  const runtimeQuestionBank = await getRuntimeQuestionBank();
  sendJson(res, 200, {
    ok: true,
    storage: {
      mode: backendStore.mode,
      persistent: backendStore.persistent
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

  const rooms = (await listRoomsWithHostExitPrune())
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
        classicMode: Boolean(room.settings?.classicMode)
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

  const deleted = await backendStore.deleteRoom(code);
  sendJson(res, deleted ? 200 : 404, {
    deleted,
    code: String(code || "").trim().toUpperCase()
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
  finalizeRoom(room);
  stampRoomEvent(room, "room_closed", { reason: "admin" });
  const storedRoom = await backendStore.upsertRoom(room);
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
    const filePath = join(root, "data", "questions.json");
    const current = JSON.parse(readFileSync(filePath, "utf8"));
    if (!Array.isArray(current)) {
      throw new Error("Question bank is not an array.");
    }

    const normalizedId = normalizeQuestionText(created.id);
    if (current.some((question) => normalizeQuestionText(question.id) === normalizedId)) {
      sendJson(res, 409, { error: `Question id already exists: ${created.id}` });
      return;
    }

    current.push(created);
    await writeFile(filePath, `${JSON.stringify(current, null, 2)}\n`);
    const normalized = normalizeSeedQuestion(created);
    if (normalized) {
      questionBank.push(normalized);
    }
    sendJson(res, 201, { question: created, total: current.length });
  } catch (error) {
    sendJson(res, 400, { error: error.message || "Could not create question." });
  }
}

async function handleUpdateDebugQuestion(req, res, originalId) {
  try {
    const body = await readRequestJson(req);
    const updated = normalizeCreatedQuestion(body);
    const filePath = join(root, "data", "questions.json");
    const current = JSON.parse(readFileSync(filePath, "utf8"));
    if (!Array.isArray(current)) {
      throw new Error("Question bank is not an array.");
    }

    const normalizedOriginalId = normalizeQuestionText(originalId);
    const index = current.findIndex((question) => normalizeQuestionText(question.id) === normalizedOriginalId);
    if (index < 0) {
      sendJson(res, 404, { error: `Question id not found: ${originalId}` });
      return;
    }

    const normalizedUpdatedId = normalizeQuestionText(updated.id);
    const duplicate = current.some((question, questionIndex) => questionIndex !== index && normalizeQuestionText(question.id) === normalizedUpdatedId);
    if (duplicate) {
      sendJson(res, 409, { error: `Question id already exists: ${updated.id}` });
      return;
    }

    current[index] = updated;
    await writeFile(filePath, `${JSON.stringify(current, null, 2)}\n`);
    const normalized = normalizeSeedQuestion(updated);
    const bankIndex = questionBank.findIndex((question) => normalizeQuestionText(question.id) === normalizedOriginalId);
    if (normalized && bankIndex >= 0) {
      questionBank[bankIndex] = normalized;
    } else if (normalized) {
      questionBank.push(normalized);
    }
    sendJson(res, 200, { question: updated, total: current.length });
  } catch (error) {
    sendJson(res, 400, { error: error.message || "Could not update question." });
  }
}

async function handleDeleteDebugQuestion(res, id) {
  try {
    const filePath = join(root, "data", "questions.json");
    const current = JSON.parse(readFileSync(filePath, "utf8"));
    if (!Array.isArray(current)) {
      throw new Error("Question bank is not an array.");
    }

    const normalizedId = normalizeQuestionText(id);
    const index = current.findIndex((question) => normalizeQuestionText(question.id) === normalizedId);
    if (index < 0) {
      sendJson(res, 404, { error: `Question id not found: ${id}` });
      return;
    }

    const [deleted] = current.splice(index, 1);
    await writeFile(filePath, `${JSON.stringify(current, null, 2)}\n`);
    const bankIndex = questionBank.findIndex((question) => normalizeQuestionText(question.id) === normalizedId);
    if (bankIndex >= 0) {
      questionBank.splice(bankIndex, 1);
    }
    sendJson(res, 200, { question: deleted, total: current.length });
  } catch (error) {
    sendJson(res, 400, { error: error.message || "Could not delete question." });
  }
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
    const body = await readRequestJson(req);
    const existingRoom = await backendStore.getRoom((body.room || body).code);
    const room = normalizeRoom(body.room || body);
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

async function listRoomsWithHostExitPrune() {
  const rooms = await backendStore.listRooms();
  const now = Date.now();
  const visibleRooms = [];

  for (const room of rooms) {
    const hostExitPendingAt = Number(room.hostExitPendingAt || 0);
    if (hostExitPendingAt && now - hostExitPendingAt >= hostExitGraceMs) {
      await backendStore.deleteRoom(room.code);
      continue;
    }
    visibleRooms.push(room);
  }

  return visibleRooms;
}

async function handleRoomPresence(req, res, code) {
  try {
    const normalizedCode = String(code || "").trim().toUpperCase();
    const room = await backendStore.getRoom(normalizedCode);
    if (!room) {
      sendJson(res, 404, { error: "Room not found." });
      return;
    }

    const body = await readRequestJson(req);
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

    if (participant.host || participant.id === room.host?.id) {
      room.hostExitPendingAt = 0;
    }
    finalizeRoom(room);
    stampRoomEvent(room, existingIndex >= 0 ? "participant_updated" : "participant_joined", {
      participantId: participant.id,
      host: Boolean(participant.host),
      spectator: Boolean(participant.spectator),
      status: participant.status
    });
    const storedRoom = await backendStore.upsertRoom(room);
    sendJson(res, 200, { room: storedRoom });
  } catch (error) {
    sendJson(res, 400, { error: error.message || "Room presence update failed." });
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

    const hadPendingExit = Boolean(room.hostExitPendingAt);
    room.hostExitPendingAt = 0;
    if (participant) {
      participant.active = true;
      participant.status = String(body.status || participant.status || "host").slice(0, 32);
    }
    finalizeRoom(room);
    if (hadPendingExit) {
      stampRoomEvent(room, "host_resumed", { participantId });
    } else {
      room.updatedAt = Date.now();
    }
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

    const body = await readRequestJson(req);
    const [message] = normalizeRoomChat([body.message || body]);
    if (!message) {
      sendJson(res, 400, { error: "Chat message is empty." });
      return;
    }
    room.chat = normalizeRoomChat([...(Array.isArray(room.chat) ? room.chat : []), message]);
    stampRoomEvent(room, "chat_message", {
      owner: message.owner,
      sender: message.sender,
      private: Boolean(message.private)
    });
    finalizeRoom(room);
    const storedRoom = await backendStore.upsertRoom(room);
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

    const body = await readRequestJson(req);
    const game = normalizeRoomGame(body.game || body);
    if (!game?.setup) {
      sendJson(res, 400, { error: "Room game update needs a setup payload." });
      return;
    }
    room.status = "in-progress";
    room.game = game;
    stampRoomEvent(room, "round_started", {
      round: game.round,
      matchId: game.matchId
    });
    finalizeRoom(room);
    const storedRoom = await backendStore.upsertRoom(room);
    sendJson(res, 200, { room: storedRoom });
  } catch (error) {
    sendJson(res, 400, { error: error.message || "Room game update failed." });
  }
}

async function handleRoomEvents(url, res, code) {
  const room = await backendStore.getRoom(String(code || "").trim().toUpperCase());
  if (!room) {
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

function normalizeRoom(room) {
  const code = String(room.code || "").trim().toUpperCase();
  if (!/^CAI-\d{4}$/.test(code)) {
    throw new Error("Invalid room code.");
  }

  const settings = room.settings && typeof room.settings === "object" ? room.settings : {};
  const host = room.host && typeof room.host === "object" ? room.host : {};
  const participants = Array.isArray(room.participants) ? room.participants.map(normalizeParticipant) : [];
  const classicMode = Boolean(settings.classicMode);
  const normalizedRoom = {
    code,
    status: ["draft", "lobby", "in-progress", "complete"].includes(room.status) ? room.status : "lobby",
    settings: {
      rounds: clampServerNumber(settings.rounds, 1, 10, 10),
      timerSeconds: clampServerNumber(settings.timerSeconds, 10, 60, 30),
      maxPlayers: clampServerNumber(settings.maxPlayers, 2, 10, 5),
      harsh: classicMode ? false : Boolean(settings.harsh),
      chaos: classicMode ? false : Boolean(settings.chaos),
      timeMoney: classicMode ? false : Boolean(settings.timeMoney),
      amplified: classicMode ? false : Boolean(settings.amplified),
      wildFire: classicMode ? false : Boolean(settings.wildFire),
      partyMayhem: classicMode ? false : Boolean(settings.partyMayhem),
      classicMode,
      private: Boolean(settings.private),
      password: String(settings.password || "").slice(0, 32),
      enabledThemes: normalizeEnabledThemes(settings.enabledThemes),
      code
    },
    host: {
      id: String(host.id || participants.find((entry) => entry.host)?.id || "host").slice(0, 80),
      name: String(host.name || "Host").slice(0, 24),
      avatar: String(host.avatar || "").slice(0, 250000),
      equippedTitleId: String(host.equippedTitleId || "").slice(0, 80),
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

function normalizeParticipant(participant) {
  const id = String(participant.id || "").slice(0, 80);
  if (!id) {
    throw new Error("Missing participant id.");
  }

  return {
    id,
    name: String(participant.name || "Guest").slice(0, 24),
    avatar: String(participant.avatar || "").slice(0, 250000),
    equippedTitleId: String(participant.equippedTitleId || "").slice(0, 80),
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
    const isHostLeaving = participantId && participantId === room.host?.id
      || room.participants.some((participant) => participant.id === participantId && participant.host);
    if (isHostLeaving) {
      if (reason === "page-exit") {
        room.hostExitPendingAt = Date.now();
        finalizeRoom(room);
        stampRoomEvent(room, "host_exit_pending", { participantId });
        const storedRoom = await backendStore.upsertRoom(room);
        sendJson(res, 200, { room: storedRoom, closed: false, reason: "host-exit-pending" });
        return;
      }
      await backendStore.deleteRoom(normalizedCode);
      sendJson(res, 200, { closed: true, code: normalizedCode, reason: "host-left" });
      return;
    }

    room.participants = room.participants.filter((participant) => participant.id !== participantId);
    finalizeRoom(room);
    const activeRealPlayers = room.participants.filter((participant) => participant.active && !participant.bot && !participant.spectator);
    if (!activeRealPlayers.length) {
      await backendStore.deleteRoom(normalizedCode);
      sendJson(res, 200, { closed: true, code: normalizedCode, reason: "empty-room" });
      return;
    }

    stampRoomEvent(room, "participant_left", { participantId });
    const storedRoom = await backendStore.upsertRoom(room);
    sendJson(res, 200, { room: storedRoom, closed: false });
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
        sender: String(source.sender || "System").slice(0, 32),
        avatar: String(source.avatar || "").slice(0, 250000),
        equippedTitleId: String(source.equippedTitleId || "").slice(0, 80),
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
    patternId: String(customization.patternId || "none").slice(0, 48)
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
    updatedAt: clampServerNumber(game.updatedAt, 0, Number.MAX_SAFE_INTEGER, Date.now())
  };
}

function finalizeRoom(room) {
  const participantById = new Map();
  room.participants.forEach((participant) => {
    if (!room.banned.includes(participant.id) && !room.banned.includes(participant.name)) {
      participantById.set(participant.id, participant);
    }
  });
  room.participants = [...participantById.values()];
  if (!room.participants.some((participant) => participant.host)) {
    room.participants.unshift({
      id: room.host.id,
      name: room.host.name,
      avatar: room.host.avatar,
      equippedTitleId: room.host.equippedTitleId || "",
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
    const data = await readFile(filePath);
    const contentType = mimeTypes[extname(filePath).toLowerCase()] || "application/octet-stream";
    const isMedia = contentType.startsWith("audio/");
    const range = isMedia ? req?.headers?.range : "";

    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (match) {
        const requestedStart = match[1] ? Number(match[1]) : 0;
        const requestedEnd = match[2] ? Number(match[2]) : data.length - 1;
        const start = Math.max(0, Math.min(data.length - 1, requestedStart));
        const end = Math.max(start, Math.min(data.length - 1, requestedEnd));
        const chunk = data.subarray(start, end + 1);
        res.writeHead(206, {
          "Content-Type": contentType,
          "Content-Length": chunk.length,
          "Content-Range": `bytes ${start}-${end}/${data.length}`,
          "Accept-Ranges": "bytes",
          "Cache-Control": "no-store"
        });
        if (!isHead) {
          res.end(chunk);
        } else {
          res.end();
        }
        return;
      }
    }

    res.writeHead(200, {
      "Content-Type": contentType,
      "Content-Length": data.length,
      ...(isMedia ? { "Accept-Ranges": "bytes" } : {}),
      "Cache-Control": "no-store"
    });
    if (!isHead) {
      res.end(data);
    } else {
      res.end();
    }
  } catch {
    sendText(res, 404, "Not found");
  }
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

function readRequestJson(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 20_000) {
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
      "Grade answers against the question, canonicalAnswer, and acceptedAnswers.",
      "Blank or empty answers are always incorrect and must never appear in correctIndexes.",
      "Accept common aliases, nicknames, abbreviations, swapped word order, missing accents, and minor spelling mistakes when the intended answer is clearly correct.",
      "Reject random objects, wrong-category guesses, or answers only vaguely related to the theme.",
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
      temperature: 1.15,
      input: [
        {
          role: "system",
          content:
            "You grade a short-answer trivia quiz. Accept clear aliases, abbreviations, missing accents, and minor spelling mistakes. Return only compact valid JSON matching the schema."
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
      temperature: 1.22,
      messages: [
        {
          role: "system",
          content:
            "You grade a short-answer trivia quiz. Accept clear aliases, abbreviations, missing accents, and minor spelling mistakes. Return only valid JSON with keys cards, winnerIndex, and correctIndexes."
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
