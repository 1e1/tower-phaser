# Tower Duel

A two-player artillery duel built with [Phaser](https://phaser.io/) 4 and bundled
with [Vite](https://vitejs.dev/). Two towers face each other across a procedural
landscape; each player sets the angle and power of a cannon. The twist on the
classic formula: **both players aim at the same time**, lock in their orders, and
the two shots fire together.

## Gameplay

- Pick player names and a round count on the setup screen.
- Each turn, the wind (strength and direction) changes and is shown at the top.
- Both players adjust their cannon simultaneously, then validate their shot.
- Once both shots are locked, the volley fires at once.
- A round is won by the first player to hit the opposing tower; the landscape is
  regenerated between rounds.
- The match winner is the player with the most rounds won.

## Controls

| Action        | Player 1 (left) | Player 2 (right) |
| ------------- | --------------- | ---------------- |
| Power up/down | `W` / `S`       | `↑` / `↓`        |
| Angle down/up | `A` / `D`       | `←` / `→`        |
| Validate shot | `Space`         | `Enter`          |

## Run locally (Node)

```bash
npm install
npm run dev      # development server on http://localhost:5173
npm run build    # production bundle in dist/
npm run preview  # serve the production bundle locally
```

## Run with Docker

```bash
docker build -t tower-duel .
docker run --rm -p 8080:80 tower-duel
```

Then open http://localhost:8080.

## Roadmap

- **Lot 1** — Dockerized single-page game (this release).
- **Lot 2** — Selectable biome themes, modernized graphics and sound.
- **Lot 3** — TV spectator view plus phone/tablet controllers.
- **Lot 4** — Worms-style destructible terrain.

## Project layout

```
src/
  main.js              Phaser game bootstrap and configuration
  config/constants.js  Shared tuning values (sizes, physics, palette)
  scenes/              Boot, Setup, Game and Result scenes
  objects/             Terrain, Tower, Projectile, Hud
  systems/             Wind
```
