# Tower Duel

A two-player artillery duel built with [Phaser](https://phaser.io/) 4 and bundled
with [Vite](https://vitejs.dev/). Two towers face each other across a procedural
landscape; each player sets the angle and power of a cannon. The twist on the
classic formula: **both players aim at the same time**, lock in their orders, and
the two shots fire together.

Since lot 3 the match is **connected**: one screen acts as the TV/spectator and
up to two phones or tablets act as the player controllers, coordinated by a Node
server that runs the authoritative simulation.

**▶ Play online:** https://git-tower-phaser.alwaysdata.net

## Gameplay

- Pick player names, a round count and a biome on the setup screen.
- Each turn, the wind (strength and direction) changes and is shown at the top.
- Both players adjust their cannon simultaneously, then validate their shot.
- Once both shots are locked, the volley fires at once.
- A round is won by the first player to hit the opposing tower; the landscape is
  regenerated between rounds.
- The match winner is the player with the most rounds won.

## Connected play (TV + controllers)

1. Open the app on the shared screen and choose **Host on this screen (TV)**.
   Open it on the host's LAN address (e.g. `http://192.168.1.20:3000`) rather
   than `localhost` so phones on the same network can reach it. The QR code
   already points at the LAN address.
2. The TV shows a 4-character room code and a QR code. It never needs input.
3. Players open the app on their phone/tablet (scan the QR or enter the code),
   type a name and join. The first player to join picks the biome and the round
   count.
4. As soon as the second player joins, the match **starts automatically**.
5. Each player sets angle and power on their device — their tower top animates
   live (cannon orientation, charge tint, windsock) — then validates. When both
   have validated, the volley fires. The TV renders the match; it shows the
   cannons moving but never the exact numbers, and has no firing controls.
6. At the end, each player chooses **Play again** or **Disconnect**. When both
   choose to play again the match restarts; the **loser picks the next biome and
   round count**.

The chooser also picks a **game mode**. *Classic* is strict turn-by-turn
volleys. *Turbo* adds a shot clock — once one player validates, the other has a
few seconds to commit, and shells fly continuously so the next shot can be aimed
the instant the previous one leaves the barrel. In turbo the **wind is
continuous too**: instead of snapping to a new value each turn, it eases between
fresh keypoints every 10 s, with a lighter gust wave on top — each match rolls
its own "gustiness", from a steady breeze to squally rafales.

The terrain is **destructible**: every shell carves a crater out of the
landscape (relief and surface decor alike), so holes, caverns and overhangs
build up over the round — Worms-style. The terrain resets each round.

Extra people who join beyond the two slots wait in an ordered queue and
spectate the match (like the TV); when a slot frees up, the next in line takes
it over — even mid-match.

The TV runs a short startup benchmark and drops to a lighter effects tier on
slow hardware. Press `M` on the TV to toggle sound.

The authoritative simulation lives in `src/sim/` (Phaser-free) and runs on the
server; clients only render the snapshots it broadcasts.

## Biomes

Four selectable biomes, each with its own sky, palette, parallax scenery and
ambient particles: **Meadow**, **Desert**, **Tundra** and **Volcano**. Sound
effects (cannon fire, explosions, impacts, menu tones) are synthesized at
runtime with the Web Audio API, so the project ships no binary audio assets.

## Run locally (Node)

```bash
npm install
npm run build       # production bundle in dist/
npm start           # Node server (SPA + realtime) on http://localhost:3000
```

For development with hot reload, run the client and the realtime server side by
side (the Vite dev server proxies `/ws` to the Node server):

```bash
npm run dev:server  # Node server on :3000
npm run dev         # Vite dev server on :5173 (open this one)
```

## Run with Docker

```bash
docker build -t tower-duel .
docker run --rm -p 8088:3000 -e PUBLIC_HOST=192.168.1.20 tower-duel
```

Then open http://localhost:8088 (or the host's LAN address for phone players).

## Server bundle (zip / tar.gz)

For a copy-paste deployment without Docker, build the lean server bundle:

```bash
npm run package     # builds, then writes release/tower-duel-<version>.{zip,tar.gz}
```

Each archive (~0.4 MB) contains only the runtime essentials — the pre-built
`dist/`, the `server/`, the Phaser-free simulation it imports (`src/sim`,
`src/config`) and the dependency manifest — with the docs, client source,
`node_modules` and CI stripped out. Copy it to any Node 18+ host, then:

```bash
npm ci --omit=dev   # installs express + ws only
npm start           # serves the game on :3000
```

The same archives are attached automatically to every tagged GitHub Release
(see `.github/workflows/release-bundle.yml`). A `DEPLOY.md` inside the bundle
covers the `PORT` / `PUBLIC_HOST` environment variables.

Inside a container the auto-detected IP is the Docker bridge address
(e.g. `172.17.0.x`), which phones can't reach. Set **`PUBLIC_HOST`** to the
host's LAN address (or a hostname) so the QR code points somewhere reachable.
When the mapped port differs from 3000, open the TV on that port — the QR code
reuses whatever port the TV page was loaded with.

## Tutorial

An illustrated, kid-friendly tutorial that walks through the four lots (with SVG
diagrams and interactive mini-simulators) lives in [`docs/`](docs/) and is
published to GitHub Pages: **https://1e1.github.io/tower-phaser/**. Enable it
once via *Settings → Pages → Source: GitHub Actions*.

The tutorial is available in five languages — English, French, German, Spanish
and Italian — under `docs/en/`, `docs/fr/`, `docs/de/`, `docs/es/` and
`docs/it/`. The site root redirects to the reader's language (defaulting to
English), and a language switcher in the page header links the matching page
across all five.

The published `docs/` is generated — never edit it by hand. The source lives in
`docs-src/` (one layout, one tokenised body per page, one JSON string catalog
per page × language), driven by `docs-src/site.config.mjs`:

```bash
npm run build:docs   # regenerate docs/ from docs-src/ (prints a coverage matrix)
```

French is the reference language; the other four derive from it. To keep the
5 × N catalogs in sync, `scripts/i18n-sync.mjs` reports drift and fills the gap
through DeepL (HTML tag mode, so `<b>`/emojis survive), translating only the
keys that are missing or whose FR source changed — not the whole corpus:

```bash
npm run i18n:check   # report drift: missing / stale (FR changed) / leftover keys
npm run i18n:sync    # translate just the diff via DeepL, then review the listed keys
```

`i18n:sync` needs `DEEPL_API_KEY` in the environment (a free key, suffix `:fx`,
routes to api-free automatically). A lockfile (`docs-src/i18n/.i18n-lock.json`)
records the FR source hash per key so a later FR edit flags every locale's
matching key as stale — commit it alongside the catalogs.

An architecture annex, **[A match's life cycle](docs/en/annex-lobby.html)**,
covers the lobby, the Architect/Rival personas, the controller/TV state machine
and the reconnection model — with four interactive simulators (start gate,
state-machine walker, 10 s reconnection grace, and the inter-round parallax
continuity).

## Roadmap

- **Lot 1** — Dockerized single-page game. *(done)*
- **Lot 2** — Selectable biome themes, modernized graphics and sound. *(done)*
- **Lot 3** — TV spectator view plus phone/tablet controllers. *(done)*
- **Lot 4** — Worms-style destructible terrain. *(done)*
- **v1.1.0** — Turbo / shot-clock mode with continuous, gusty wind; QR host
  override; copy-paste server bundle (zip / tar.gz); game emblem on the home
  screens; cleaner phone end-screen; distance-math optimizations
  (squared-distance comparisons); and a three-level tutorial
  (Discovery / Intermediate / Expert) with a new *fast maths* annex. *(done)*
- **v1.2.0** — Pre-match setup overhaul: the name is remembered on the device,
  Escape returns to the home screen (the host tears the room down, a phone just
  disconnects), a locked/slept phone keeps its seat for 10s and auto-reconnects,
  and the match no longer auto-starts — the first player configures it inside a
  depth-scroll scene (settings framed between two towers) then a player claims a
  side by tapping a tower, with a mutual ready gate. Plus binary snapshot frames,
  gzip and projectile interpolation for a smoother, lighter wire. *(done)*

## Project layout

```
server/                Node server: HTTP + WebSocket rooms, authoritative loop
src/
  main.js              Phaser game bootstrap and configuration
  config/              Shared tuning values and biome theme definitions
  sim/                 Phaser-free authoritative simulation (rng, terrain,
                       geometry, Simulation) shared by server and renderer
  net/                 WebSocket client wrapper
  render/              Renderer-agnostic visuals (charge tint, windsock)
  ui/                  Plain-canvas tower-top mini view (controller)
  scenes/              Boot, Lobby, Tv, Controller (remote) + Setup, Game,
                       Result (local, kept from lots 1-2)
  objects/             Terrain, Tower, Projectile, Hud, Background
  systems/             Wind, Sfx, texture generation, render benchmark
```

The local keyboard scenes (Setup/Game/Result) from lots 1-2 remain in the code
base but the menu now starts in the connected lobby.
