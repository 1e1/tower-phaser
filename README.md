# Tower Duel

A two-player artillery duel built with [Phaser](https://phaser.io/) 4 and bundled
with [Vite](https://vitejs.dev/). Two towers face each other across a procedural
landscape; each player sets the angle and power of a cannon. The twist on the
classic formula: **both players aim at the same time**, lock in their orders, and
the two shots fire together.

Since lot 3 the match is **connected**: one screen acts as the TV/spectator and
up to two phones or tablets act as the player controllers, coordinated by a Node
server that runs the authoritative simulation.

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
docker run --rm -p 8088:3000 tower-duel
```

Then open http://localhost:8088 (or the host's LAN address for phone players).

## Roadmap

- **Lot 1** — Dockerized single-page game. *(done)*
- **Lot 2** — Selectable biome themes, modernized graphics and sound. *(done)*
- **Lot 3** — TV spectator view plus phone/tablet controllers. *(done)*
- **Lot 4** — Worms-style destructible terrain. *(done)*

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
