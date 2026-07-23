# Trivia Against AI

Trivia Against AI is a web-based trivia party game where players answer AI-generated questions, compete for points, use power-ups, unlock cosmetics, and play in solo, local, or online multiplayer modes.

The app combines traditional trivia with AI-assisted answer grading, so answers can be judged more flexibly than exact string matching.

## Features

- Solo vs Bots, Local 1v1, and hosted multiplayer rooms.
- Public and private rooms with short invite links such as `/1234`.
- AI-generated trivia questions, bot answers, and answer grading.
- Multiple-choice and typed-answer question formats.
- Power-ups, modifiers, score effects, and animated round results.
- Spectator support, room chat, bots, and realtime multiplayer syncing.
- Player profiles with avatars, cosmetics, badges, achievements, coins, and settings.
- User-submitted question cards with admin review tools.
- Supabase-backed account/profile storage and optional Redis/Upstash room storage.

## Run Locally

Install dependencies, create a `.env` from `.env.example`, then start the server:

```bash
npm install
npm start
```

Open:

```text
http://localhost:3000
```

The app needs the Node server for API routes, AI calls, rooms, auth helpers, and static file serving. Opening `index.html` directly is only useful for inspecting static layout.

## Environment

Required for AI gameplay:

```text
COMPUTINGER_API_KEY=your_computinger_key_here
AI_BASE_URL=https://www.computinger.com/v1
AI_MODEL=gpt-5.4-mini
AI_API_STYLE=chat
```

Recommended for production features:

```text
ADMIN_TOKEN=replace_with_a_long_random_admin_token
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_JWT_SECRET=
INVENTORY_AUTH_MODE=enforce
QUESTION_SUBMISSION_AUTH_MODE=enforce
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
```

Use `.env.example` as the source of truth for all supported variables.

## Scripts

```bash
npm start
npm run check
npm run test:grading
npm run test:rooms
```

- `npm start` runs the local server.
- `npm run check` checks JavaScript syntax.
- `npm run test:grading` runs answer grading tests.
- `npm run test:rooms` runs room/API integration tests.

## Deploy

The project is configured for Vercel with `api/index.js` and `vercel.json`. Vercel routes requests through the same `server.js` handler used locally.

For Vercel:

- Import the GitHub repository.
- Keep the root directory as the project root.
- Leave the build command empty unless you add a build step later.
- Add the required environment variables in Vercel project settings.
- Do not set `PORT`; Vercel provides it automatically.

## Project Structure

```text
index.html                 Main app markup
styles.css                 Main app styling
app.js                     Client-side game logic
server.js                  API routes and static server
api/index.js               Vercel serverless entrypoint
assets/                    Icons, fonts, audio, and visual assets
data/                      Question/content data
tests/                     Node test files
supabase-user-storage.sql  Supabase storage schema helpers
```
