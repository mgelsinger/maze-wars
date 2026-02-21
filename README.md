# MAZE WARS

A real-time multiplayer procedurally-generated maze racing game with a neon cyberpunk aesthetic. Players race through glowing mazes, collect powerups, and compete head-to-head in 1v1 matches.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | HTML5 Canvas + vanilla JavaScript (ES modules, no framework) |
| Backend | Node.js + Express + Socket.IO |
| Database | SQLite via `better-sqlite3` |
| Auth | Username + localStorage |

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

