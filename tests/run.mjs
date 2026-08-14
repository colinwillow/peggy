// Test runner: brings up a static server, runs the suites against it, tears it
// down. Exists so `npm test` is one command with no setup — a test you have to
// remember to start a server for is a test that stops getting run.

import { spawn } from 'node:child_process';
import { once } from 'node:events';

const PORT = process.env.PEGGY_PORT || 8123;
const BASE = `http://localhost:${PORT}/index.html`;

function serve() {
  const p = spawn('python3', ['-m', 'http.server', String(PORT)], {
    stdio: 'ignore',
    detached: false,
  });
  return p;
}

async function waitForServer(timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(BASE);
      if (r.ok) return true;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

function run(script, args = []) {
  const p = spawn(process.execPath, [script, ...args], { stdio: 'inherit' });
  return once(p, 'exit').then(([code]) => code ?? 1);
}

const server = serve();
let exitCode = 1;
try {
  if (!(await waitForServer())) {
    console.error(`could not reach ${BASE} — is python3 available?`);
    process.exit(1);
  }
  console.log(`\n▸ locomotion (deterministic controller checks)`);
  const a = await run(new URL('./locomotion.mjs', import.meta.url).pathname, [BASE]);

  console.log(`▸ gestures (touch-event separation on the right stick)`);
  const g = await run(new URL('./gestures.mjs', import.meta.url).pathname, [BASE]);

  console.log(`▸ smoke (boots, renders, screenshots to /tmp/peggy-shots)`);
  const b = await run(new URL('./smoke.mjs', import.meta.url).pathname, [BASE, '/tmp/peggy-shots']);

  exitCode = a || g || b;
} finally {
  server.kill();
}
process.exit(exitCode);
