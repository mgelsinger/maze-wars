# MAZE WARS

A real-time multiplayer procedurally-generated maze racing game with a neon cyberpunk aesthetic. Players race through glowing mazes, collect powerups, and compete head-to-head in 1v1 matches.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | HTML5 Canvas + vanilla JavaScript (ES modules, no framework) |
| Backend | Node.js + Express + Socket.IO |
| Database | SQLite via `better-sqlite3` *(Phase 4)* |
| Auth | Username + localStorage *(Phase 4 for persistence)* |

---

## Project Structure

```
maze-wars/
├── server/
│   ├── index.js              # Express + Socket.IO entry point
│   ├── maze-generator.js     # Maze generation (CommonJS, mirrors client version)
│   └── game-room.js          # Room management, server-authoritative game loop
├── public/
│   ├── index.html            # SPA shell — all screens in one file
│   ├── css/
│   │   └── style.css         # Full neon/cyberpunk theme
│   └── js/
│       ├── main.js           # App boot, screen management, navigation
│       ├── maze-generator.js # Maze generation (ES module, seeded PRNG)
│       ├── renderer.js       # Canvas rendering engine (walls, player, ghost, minimap)
│       ├── particles.js      # Particle effects system
│       ├── audio.js          # Synthesised sound effects (Web Audio API)
│       ├── input.js          # Keyboard + touch D-pad input
│       ├── network.js        # Socket.IO client wrapper + event bus
│       ├── ui.js             # DOM HUD updates (timer, score, effects, opponent)
│       └── screens/
│           ├── menu.js       # Main menu with animated maze background
│           ├── lobby.js      # Room create/join flow, VS sub-panels
│           ├── game.js       # In-game loop (solo + VS modes)
│           └── results.js    # Post-game results (solo stats + VS comparison)
├── maze-game-spec.md         # Full game specification
└── package.json
```

---

## Running the Game

```bash
npm install
npm start
# → http://localhost:3000
```

Requires Node.js 18+. The server serves all static files and handles Socket.IO connections on the same port.

---

## Architecture Notes

### Maze Generation
- Algorithm: iterative recursive backtracking (avoids call-stack overflow on large mazes)
- Seeded PRNG: `mulberry32` — same seed produces identical maze on both server and client
- Only the **seed** is sent over the network; both sides regenerate locally
- Four sizes: 15×15 (Small), 21×21 (Medium), 31×31 (Large), 41×41 (Huge)

### Movement Model
- Cell-by-cell movement with 150ms/cell base speed
- Client-side prediction with server confirmation/rubber-banding
- Input buffering: one queued direction while animating
- Server rate-limits to prevent speed hacks (`moveSpeed - 30ms` threshold)

### VS Mode Flow
```
Menu → Lobby → Create Room / Join Room → Ready → 3-2-1 Countdown → Race → Results → Rematch
```
- Server emits `game-start` immediately when both players are ready
- Server waits 3.6s grace period before accepting moves (matches client countdown)
- Server broadcasts `game-state` at 20 ticks/second
- Opponent rendered as a translucent magenta ghost with flicker effect
- Results screen listens directly for `game-start` to handle rematches without lobby round-trip

### Screen Navigation
All screens are ES module classes with `show(data)` / `hide()` lifecycle methods:

| Route | Class | File |
|-------|-------|------|
| `menu` | `MenuScreen` | `screens/menu.js` |
| `lobby` | `LobbyScreen` | `screens/lobby.js` |
| `game` | `GameScreen` | `screens/game.js` |
| `results` | `ResultsScreen` | `screens/results.js` |

---

## Build Progress

### ✅ Phase 1 — Core Solo Play
1. Maze generation algorithm (iterative backtracker + BFS validation)
2. Canvas rendering — neon walls, player glow, visited cell trail, exit portal, minimap
3. Player movement — keyboard + touch D-pad, smooth lerp animation, input buffering
4. Timer and HUD — sidebar with level, score, streak, ELO, active effects
5. Solo race-to-exit mode with score breakdown on results screen

### ✅ Phase 2 — Multiplayer Foundation
6. Express + Socket.IO server
7. Room creation and joining with 6-character codes
8. Two-player synchronised game state (server-authoritative, 20 ticks/sec)
9. Ghost opponent rendering — translucent magenta with lerp smoothing
10. Countdown and win condition; VS results screen with side-by-side comparison and rematch

---

## ▶ Phase 3 — Powerups & Polish (next)

> **Spec reference:** `maze-game-spec.md` — sections 3 (Powerups), 7 (Visual Design / Sound), 9 (Scoring)
> **Spec items:** 11–15

### What to build

**11. Powerup spawning (`server/game-room.js` + `server/maze-generator.js`)**
- Two types defined in spec:
  - **Speed Boost** — 1.7× speed for 5 seconds; cyan/lightning visual
  - **Freeze** — opponent frozen for 3 seconds; ice-blue crystal visual
- Placement rules: never within 3 cells of start/exit; minimum 5 cells apart; ≥1 freeze off optimal path
- Registry pattern for future extensibility (see `POWERUP_REGISTRY` in spec section 3)
- Server must track collected state and broadcast via `game-state` `powerups` array (already stubbed as `[]`)

**12. Speed boost + freeze effects**
- Server: apply effect to player object, adjust `moveSpeed`, track remaining duration via timestamps
- Server: emit `powerup-collected`, `powerup-activated`, `player-frozen` events (see spec section 4 protocol)
- Client `game.js`: handle `player-frozen` → disable input, show freeze overlay; speed boost → increase animation speed
- `ui.js`: the `updateEffects()` method already exists and renders effect badges with countdowns

**13. Particle effects polish (`public/js/particles.js`)**
- The `ParticleSystem` class exists but is minimal — extend it with:
  - Powerup collection burst (colored particles radiating outward)
  - Speed boost particle stream trailing behind player
  - Freeze hit — ice crystal particles exploding from victim
  - Win explosion already exists; verify it fires correctly

**14. Sound effects (`public/js/audio.js`)**
- `AudioManager` class exists with stubs — implement the missing synth sounds:
  - Powerup collect: rising arpeggio
  - Speed boost activate: whoosh (filtered noise)
  - Freeze hit: ice crack (noise burst)
  - Freeze received: descending tone / hum
- All sounds use Web Audio API — no audio files needed

**15. Post-game results improvements**
- Add powerup stats to results: collected, freezes used, times frozen
- ELO change display (animated +/- delta) — compute locally until Phase 4 DB lands
- Powerup bonus scoring: +200 per powerup collected, +300 per successful freeze (see spec section 9)

### Key files to create / modify for Phase 3

| File | Action |
|------|--------|
| `server/powerups.js` | **Create** — `POWERUP_REGISTRY`, `spawnPowerups(maze)`, collection/activation logic |
| `server/maze-generator.js` | **Modify** — call `spawnPowerups()` after maze generation; include `powerups` in returned data |
| `server/game-room.js` | **Modify** — track powerup state per room; process collection in `processInput`; apply/expire effects in tick; emit `powerup-collected`, `powerup-activated`, `player-frozen` |
| `public/js/renderer.js` | **Modify** — draw powerup orbs (rotating shapes + glow); draw speed-trail; draw freeze aura on frozen player |
| `public/js/particles.js` | **Modify** — add `addBurst(x, y, color)`, `addTrailStream(x, y)`, `addFreezeExplosion(x, y)` |
| `public/js/audio.js` | **Modify** — implement `playPowerupCollect()`, `playSpeedBoost()`, `playFreezeHit()`, `playFrozen()` |
| `public/js/screens/game.js` | **Modify** — handle `powerup-collected`/`player-frozen` events; apply speed multiplier to `moveSpeed`; trigger freeze overlay via `ui.showFreezeOverlay()` |
| `public/js/screens/results.js` | **Modify** — add powerup stat rows and ELO delta display |

---

## Phase 4 — Matchmaking & Stats (future)

> **Spec reference:** sections 4 (Public Matchmaking), 6 (Stats System)
> **Spec items:** 16–20

- SQLite database (`server/db.js`) — players, matches, player_stats tables (schema in spec section 6)
- Player registration with session tokens
- Public matchmaking queue (`server/matchmaking.js`) — ELO-range pairing, 60s timeout
- ELO rating updates after every match (K-factor 32)
- Leaderboards screen — fastest times per maze size, highest ELO, win streaks

## Phase 5 — AI & External API (future)

> **Spec reference:** section 5 (AI Bot System)
> **Spec items:** 21–24

- Built-in bots: GLITCH (easy/BFS), CIPHER (medium/A*), NEXUS (hard/perfect)
- External AI WebSocket API at `ws://host/ai-api` — documented protocol for connecting custom models
- AI bot leaderboard in UI

## Phase 6 — Polish & Mobile (future)

> **Spec reference:** sections 10 (Mobile), 8 (Screens/UI)
> **Spec items:** 25–29

- Responsive layout: sidebar collapses to top bar on screens < 768px
- Swipe-up stats panel on mobile
- Reconnection handling and room cleanup edge cases
- Menu transition animations

---

## Spec Reference

The complete original specification is in [`maze-game-spec.md`](./maze-game-spec.md). All phase decisions, network protocol, database schema, visual design tokens, and scoring formulas are documented there. When starting a new phase, read the relevant spec sections first before writing any code.
