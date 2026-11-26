import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

test('the Vercel entry serves the planner and shared API over HTTP', { timeout: 10_000 }, async (t) => {
  const entry = fileURLToPath(new URL('../server.ts', import.meta.url));
  const env = { ...process.env, PORT: '0' };
  delete env.GEMINI_API_KEY;
  const child = spawn(process.execPath, [entry], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  const output = createInterface({ input: child.stdout });
  const stopped = once(child, 'close');
  child.stderr.resume();
  t.after(async () => {
    output.close();
    child.kill();
    await stopped;
  });
  const line = await Promise.race([
    once(output, 'line', { signal: AbortSignal.timeout(5000) }).then(([message]) => message),
    stopped.then(([code]) => { throw new Error(`Vercel entry exited before listening (code ${code})`); }),
  ]);
  const port = /^AirShift listening on port ([0-9]+)$/.exec(line)?.[1];
  assert.ok(port, line);
  const origin = `http://127.0.0.1:${port}`;
  const home = await fetch(`${origin}/?sample=1`);
  assert.equal(home.status, 200);
  assert.match(home.headers.get('content-security-policy'), /default-src 'self'/);
  assert.match(await home.text(), /AirShift/);
  const script = await fetch(`${origin}/forecast-client.mjs`);
  assert.equal(script.status, 200);
  assert.match(await script.text(), /export async function requestForecast/);
  const routine = await fetch(`${origin}/api/routine`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({ note: 'School pickup is at 4 pm.' }),
  });
  assert.equal(routine.status, 503);
  assert.match((await routine.json()).error, /still edit the plan/);
});
