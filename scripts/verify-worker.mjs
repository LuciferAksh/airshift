import assert from 'node:assert/strict';
import worker from '../dist/server/index.js';
import { files } from '../server/http.mjs';

const origin = 'https://airshift.example';
const request = (path, options) => worker.fetch(new Request(origin + path, options), {});

for (const [route, [, contentType]] of Object.entries(files)) {
  const response = await request(route);
  assert.equal(response.status, 200, route);
  assert.equal(response.headers.get('Content-Type'), contentType, route);
  assert.ok((await response.arrayBuffer()).byteLength > 0, route);
}

const home = await request('/');
assert.match(await home.text(), /data-forecast-transport="browser"/);

const routine = await request('/api/routine', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: origin },
  body: JSON.stringify({ note: 'School pickup is at 4 pm.' }),
});
assert.equal(routine.status, 503);
assert.match((await routine.json()).error, /still edit the plan/);

assert.equal((await request('/.env')).status, 404);
console.log('Worker serves all registered assets and returns the expected Gemini-unavailable response.');
