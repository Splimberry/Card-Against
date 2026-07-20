# Trivia Against AI

A trivia party game with Solo vs Bots, Local 1v1, and multiplayer rooms. Questions come from the persistent question bank, while the Node API uses a configured AI model to grade short player answers with alias, typo, and partial-name tolerance.

## Run

Open `index.html` directly only to inspect the static layout. Actual gameplay requires the local server because setup, grading, room storage, auth config, and admin APIs are served by `server.js`.

For the Computinger-backed version:

1. Open `.env`.
2. Paste your Computinger key after `COMPUTINGER_API_KEY=`.
3. Replace `AI_BASE_URL` with the exact base URL from Computinger.
4. Run `npm start`.
5. Open `http://localhost:3000`.

The local `.env` is prepared for `gpt-5.4-mini`, which is available on the verified Computinger model list:

```text
COMPUTINGER_API_KEY=your_key_here
AI_BASE_URL=https://your-computinger-base-url/v1
AI_MODEL=gpt-5.4-mini
AI_API_STYLE=chat
PORT=3000
```

Use the exact base URL from your Computinger dashboard. The app will call `POST /chat/completions` when `AI_API_STYLE=chat`.

## Scripts

- `npm start` runs the local web server plus `/api/setup`, `/api/round`, room APIs, auth config, and admin routes.
- `npm run check` checks JavaScript syntax.

## Deploy to Vercel

This app is prepared for Vercel with `api/index.js` and `vercel.json`. The same `server.js` handler runs locally with `npm start` and on Vercel as a serverless function.

1. Push this repository to GitHub.
2. In Vercel, create a new project and import `Splimberry/Card-Against`.
3. Use the project root as the root directory.
4. Leave build settings empty/default; this app does not need a build command.
5. Add these Vercel environment variables before deploying:

```text
COMPUTINGER_API_KEY=your_key_here
AI_BASE_URL=https://your-computinger-base-url/v1
AI_MODEL=gpt-5.4-mini
AI_API_STYLE=chat
```

Do not add `PORT` in Vercel. Vercel provides the runtime port automatically.

## Backend Management

The app now has a backend storage layer for hosted rooms:

- Local development uses in-memory storage.
- Production uses Redis over REST when `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` are configured.
- The legacy Vercel KV names `KV_REST_API_URL` and `KV_REST_API_TOKEN` also work.

Set these extra environment variables before deploying:

```text
ADMIN_TOKEN=use_a_long_random_secret
UPSTASH_REDIS_REST_URL=your_redis_rest_url
UPSTASH_REDIS_REST_TOKEN=your_redis_rest_token
SUPABASE_URL=your_supabase_project_url
SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_JWT_SECRET=your_supabase_jwt_secret
INVENTORY_AUTH_MODE=enforce
QUESTION_SUBMISSION_AUTH_MODE=enforce
ROOM_TTL_SECONDS=21600
```

Inventory, economy, and question-submission writes accept Supabase bearer tokens when `SUPABASE_JWT_SECRET` is configured. Use `INVENTORY_AUTH_MODE=enforce` and `QUESTION_SUBMISSION_AUTH_MODE=enforce` in production so user-owned data must match the signed-in Supabase user. Use `warn` only while confirming signed-in traffic is authenticated, and use `off` only for local compatibility testing.

Shop purchases should go through `POST /api/user/inventory/purchase`, and milestone claims should go through `POST /api/user/inventory/milestone`. In `enforce` mode, legacy purchase and reward-bearing milestone operations sent through `/api/user/inventory/ops` are skipped so the server-owned economy endpoints are the source of truth.

Protected admin endpoints require:

```text
Authorization: Bearer your_admin_token
```

Available management endpoints:

- `GET /api/admin/status` checks backend health, storage mode, room counts, and question counts.
- `GET /api/admin/rooms` lists hosted rooms without exposing room passwords or full avatars.
- `POST /api/admin/rooms/:code/close` marks a room complete.
- `DELETE /api/admin/rooms/:code` removes a room from the room directory.

## Admin Dev Tool Access

The main-menu Dev Tool is locked behind an admin session.

1. Set `ADMIN_TOKEN` in Vercel.
2. Open the public app.
3. Click `Admin Login`.
4. Paste the private `ADMIN_TOKEN`.

The server creates a signed HttpOnly admin session cookie. The `/api/debug/questions` routes require either that admin session cookie or an `Authorization: Bearer ADMIN_TOKEN` header.

Supabase Auth is optional but supported for public player login:

1. Create a Supabase project.
2. In Supabase Auth providers, enable Google.
3. Add the deployed app URL to Supabase Auth redirect URLs.
4. Add `SUPABASE_URL` and `SUPABASE_ANON_KEY` to Vercel environment variables.
5. Redeploy.

When configured, the profile card shows Google sign-in and sign-out controls. When not configured, the app keeps using the local profile.

For shorter synced profile pictures, create a public Supabase Storage bucket named `profile-avatars`.
Add Storage policies that let authenticated users upload/update/read objects in that bucket. The app uploads each user's avatar to `profile-avatars/<user-id>/avatar.webp` and stores the public URL instead of sending a large base64 image through room sync. If Storage is not configured yet, avatar uploads fall back to a smaller compressed local image.

Notes for public hosting:

- Hosted room directory state is persistent only when Redis REST environment variables are configured.
- Debug question editing saves to backend storage on serverless hosting when the app cannot write to `data/questions.json`.
- Solo, local, and multiplayer gameplay use `/api/setup` for question-bank setup and `/api/round` for AI-assisted answer grading.

## Current Loop

- Choose Solo vs Bots, Local 1v1, Create Room, or Join Game.
- Set a username and profile picture from the compact profile panel in the main menu corner.
- Matches can last 1-10 rounds.
- Round wins are worth 1,000 points, with +500 for each consecutive-win streak step.
- Score gains animate, and active win streaks get a hot streak effect.
- Sound effects use local audio assets, with looping background music.
- Background music starts by default after the first browser interaction, with sound controls beside menu/header actions.
- Settings are available from the main menu and in-game for SFX volume, music volume, answer timer length, and match length.
- Players have a countdown timer for answers; it warns once at 10 seconds and flashes red only during the active answer phase.
- `/api/setup` selects a trivia question from the question bank, respecting enabled themes and recent-question avoidance.
- `/api/round` grades submitted answers with the configured AI model, then validates the result with local fuzzy matching as a safety net.
- In Solo vs Bots, the player submits one raw phrase and bot guesses usually come from the saved question data.
- In Local 1v1, players enter privately one at a time on the same screen.
- Create Room opens a multiplayer setup screen with room code, player icons, public/private room privacy, optional private password, 1-10 round setting, 10-60 second timer, Harsh mode, Chaos mode, and Time Is Money mode.
- The Create Room participant preview is a vertical list, while the lobby uses a compact scroller for joined players.
- After Create Room, the match does not start immediately. The host lands in a waiting lobby with room chat, Settings, Leave, and Begin Match.
- Join Game lists hosted public and private rooms with host profile, host crown, mode tags, active players, spectators, and separate Join Game/Spectate actions. You can also type a room code directly or create a room from that screen.
- A newly created room stays joinable until the host begins the match; after that, late joiners enter as spectators.
- Spectators can use chat and stay spectating or continue playing after the match ends.
- Multiplayer rooms use a single answer box per client. After submitting, players see waiting status while the timer continues without warning sounds or red screen flash for already-submitted players.
- Room chat sits beside the table in multiplayer, uses profile avatars, and aligns your messages to the right.
- Host chat messages are highlighted, private system messages are muted gray, and chat profiles can expose moderation actions.
- The host controls early game ending, muting, direct bans, and vote bans.
- Any player can leave a room or match, which posts a room chat message locally.
- Vote ban requires at least 3 active players and passes when more than 50% vote yes; kicked players are marked banned from that room code.
- Harsh mode makes every non-winner lose 500 points.
- Chaos mode refills and rerolls power-ups every round.
- Time Is Money replaces the base 1,000 win payout with remaining seconds x 20.
- Table Flip now cancels the current round and wipes prolonged power-up effects. Bottom Feeder lasts 3 rounds. Last Laugh doubles points gained that round instead of adding a flat bonus.
- Targeted power-ups use a clickable player picker, and panels/modals use smooth slide/fade transitions.
- In matches with more than 2 active players, the table can like/dislike the winning card for an immediate random 100-250 point adjustment.
- Ending a match early now resolves final effects such as Hot Potato and Red Herring reveals before deciding the winner.
- The API grades submitted trivia answers against the canonical answer and accepted answer list, including aliases, abbreviations, partial person names, and minor spelling mistakes.
- The winner card completes the black card before the verdict appears.
- Verdicts auto-advance after 15 seconds with a countdown on the Next Round button, and overlay menus close automatically when the next round begins.
- A match can be ended early from the game header.

## Next Steps

- Move scoring and power-up resolution into smaller testable modules.
- Continue replacing fallback polling with realtime deltas where it reduces traffic.
- Add more focused integration tests around multiplayer sync, power-up state, and auth/profile reset behavior.
- Improve question-review tooling for duplicate detection, answer aliases, and image health checks.



## rework or bug fix or new abilities



## bug fix
