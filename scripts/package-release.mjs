// Build the lean "copy-paste server" deliverable: a zip and a tar.gz holding
// only what a Node host needs to run the connected game — the pre-built bundle,
// the server, the Phaser-free simulation it imports, and the dependency
// manifest. Everything else (docs, client source, node_modules, CI, Docker) is
// stripped so the archive stays small.
//
//   npm run package      (runs the build first, then this script)
//
// Output lands in release/:  tower-duel-<version>.zip  and  .tar.gz

import { readFileSync, rmSync, mkdirSync, cpSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const name = `tower-duel-${pkg.version}`;
const outDir = join(root, 'release');
const stage = join(outDir, name);

if (!existsSync(join(root, 'dist', 'index.html'))) {
  console.error('✗ dist/ is missing or empty. Run `npm run build` first (or use `npm run package`).');
  process.exit(1);
}

// Only the runtime essentials. The server imports src/sim and src/config at
// runtime; the rest of src/ is already compiled into dist/.
const INCLUDE = ['dist', 'server', 'src/sim', 'src/config', 'package.json', 'package-lock.json', 'LICENSE'];

rmSync(outDir, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
for (const rel of INCLUDE) {
  const from = join(root, rel);
  if (!existsSync(from)) {
    console.error(`✗ expected ${rel} but it is missing.`);
    process.exit(1);
  }
  cpSync(from, join(stage, rel), { recursive: true });
}

const DEPLOY = `# Tower Duel — server bundle (v${pkg.version})

A pre-built, copy-paste deployment. The game is already compiled, so there is
no build step: copy this folder to any host with **Node.js 18+** and run it.

## Run

    npm ci --omit=dev    # install express + ws only (a few MB)
    npm start            # = node server/index.js, serves the game on :3000

Then open http://<host>:3000 on the shared screen (TV). Players join from phones
on the same network by scanning the QR code or entering the room code.

## Configure (optional environment variables)

- PORT         listening port (default 3000)
- PUBLIC_HOST  host/IP advertised in the TV's QR code — set this to a reachable
               LAN IP or domain when the auto-detected address is not reachable
               from phones (e.g. behind a reverse proxy or in a container).

    PORT=8080 PUBLIC_HOST=towerduel.example.com npm start

## What's inside

- dist/                 the built single-page game (served as static files)
- server/               Node HTTP + WebSocket server (authoritative match loop)
- src/sim, src/config   the Phaser-free simulation the server imports
- package.json + lock   runtime dependencies (express, ws)

For HTTPS / reverse-proxy notes (the WebSocket upgrade headers), see the
tutorial's technical annex: https://1e1.github.io/tower-phaser/
`;
writeFileSync(join(stage, 'DEPLOY.md'), DEPLOY);

// Archive both formats. The single top-level folder keeps extraction tidy.
execFileSync('tar', ['-czf', `${name}.tar.gz`, name], { cwd: outDir, stdio: 'inherit' });
execFileSync('zip', ['-rq', `${name}.zip`, name], { cwd: outDir, stdio: 'inherit' });

const mb = (p) => `${(statSync(p).size / 1024 / 1024).toFixed(2)} MB`;
console.log('\n✓ Server bundle ready in release/');
console.log(`  ${name}.tar.gz  (${mb(join(outDir, `${name}.tar.gz`))})`);
console.log(`  ${name}.zip     (${mb(join(outDir, `${name}.zip`))})`);
