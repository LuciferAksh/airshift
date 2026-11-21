import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { appServer } from '../server/app.mjs';
import { defaults } from '../public/catalog.mjs';
import { sampleForecast } from '../public/planner.mjs';
import { parseCurrent, parseForecast, tomorrowAt } from '../public/air-data.mjs';
import { forecastService } from '../server/forecast.mjs';
import { extractRoutine } from '../server/gemini.mjs';

const date = '2026-11-21';
const timestamp = Date.parse('2026-11-20T04:00:00Z');
const forecast = () => ({
  hourly_units: { pm2_5: 'μg/m³' },
  hourly: {
    time: Array.from({ length: 24 }, (_, hour) => `${date}T${String(hour).padStart(2, '0')}:00`),
    pm2_5: Array(24).fill(44), us_aqi: Array(24).fill(90),
  },
});

test('recommendation endpoint checks origin and input before calling the ranker', async (t) => {
  const answer = { schedule: 'lowest', indoor: 'dust', travel: 'transit', rationale: 'A lower exposure slot and available rail match your chosen priorities.' };
  let calls = 0;
  const url = await launch(t, { key: 'test-key', rank: async (context) => {
    calls += 1;
    assert.ok(context.schedule.lowest);
    assert.ok(context.travel.transit);
    assert.equal('hours' in context, false);
    return answer;
  } });
  const request = (body, origin = url) => fetch(`${url}/api/recommendations`, { method: 'POST', headers: { 'content-type': 'application/json', origin }, body: JSON.stringify(body) });
  const body = { profile: defaults(), hours: sampleForecast('delhi').hours, mode: 'sample', preferences: { priority: 'exposure', concern: 'unknown', rail: true, combine: false } };
  assert.equal((await request(body, 'https://example.com')).status, 403);
  assert.equal((await request({ ...body, mode: 'invented' })).status, 400);
  assert.equal(calls, 0);
  assert.deepEqual(await (await request(body)).json(), { recommendation: answer });
  assert.equal(calls, 1);
});

async function launch(t, config) {
  const server = await appServer(config);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  return `http://127.0.0.1:${server.address().port}`;
}

test('forecast tomorrow rolls over at midnight in India; incomplete data fails closed', () => {
  assert.equal(tomorrowAt(Date.parse('2026-11-20T18:29:59Z'), 'Asia/Kolkata'), '2026-11-21');
  assert.equal(tomorrowAt(Date.parse('2026-11-20T18:30:00Z'), 'Asia/Kolkata'), '2026-11-22');
  assert.equal(tomorrowAt(Date.parse('2026-11-20T18:30:00Z'), 'America/New_York'), '2026-11-21');
  const payload = forecast();
  assert.equal(parseForecast(payload, 'delhi', date, 'stamp').hours.length, 24);
  payload.hourly.pm2_5[14] = null;
  assert.throws(() => parseForecast(payload, 'delhi', date, 'stamp'), /Incomplete forecast/);
});

test('location forecast rounds coordinates and resolves the timezone with the provider', async () => {
  let calls = 0;
  const getForecast = forecastService(async (endpoint) => {
    calls += 1;
    const { searchParams } = new URL(endpoint);
    assert.equal(searchParams.get('latitude'), '19.1');
    assert.equal(searchParams.get('longitude'), '72.9');
    assert.equal(searchParams.get('timezone'), 'auto');
    assert.match(searchParams.get('current'), /us_aqi/);
    return Response.json({ ...forecast(), timezone: 'Asia/Kolkata', current: { time: '2026-11-20T09:30', us_aqi: 92, pm2_5: 31, us_aqi_pm2_5: 92 } });
  }, () => timestamp);
  const local = await getForecast({ lat: 19.076, lon: 72.8777 });
  assert.equal(local.city, null);
  assert.equal(local.timezone, 'Asia/Kolkata');
  assert.equal(local.current.top, 'PM₂.₅');
  assert.ok(!('lat' in local));
  await getForecast({ lat: 19.089, lon: 72.888 });
  assert.equal(calls, 1);
  await assert.rejects(getForecast({ lat: 90.1, lon: 72.9 }), /Invalid/);
});

test('current conditions retain zero values and identify the highest valid subindex', () => {
  const time = '2026-11-20T09:30';
  assert.deepEqual(parseCurrent({ time, us_aqi: 85, pm2_5: 0, pm10: null, us_aqi_pm2_5: 0, us_aqi_ozone: 85 }), {
    time, aqi: 85, pm: 0, pm10: null, top: 'Ozone',
  });
  assert.equal(parseCurrent({ time, us_aqi: null }), null);
  assert.equal(parseCurrent({ time: '', us_aqi: 45 }), null);
});

test('concurrent city requests share a fetch and expired forecasts refresh', async () => {
  let calls = 0;
  let now = timestamp;
  const getForecast = forecastService(async () => { calls += 1; return Response.json(forecast()); }, () => now);
  await Promise.all([getForecast('delhi'), getForecast('delhi')]);
  assert.equal(calls, 1);
  await getForecast('patna');
  now += 15 * 60_000;
  await getForecast('delhi');
  assert.equal(calls, 3);
});

test('a failed forecast can be retried', async () => {
  let calls = 0;
  const getForecast = forecastService(async () => ++calls === 1 ? Response.error() : Response.json(forecast()), () => timestamp);
  await assert.rejects(getForecast('delhi'), /unavailable/);
  assert.equal((await getForecast('delhi')).hours.length, 24);
});

test('Gemini uses a server-side header and independently validates returned settings', async () => {
  const gemini = (draft, finishReason = 'STOP') => async (_, request) => {
    assert.equal(request.headers['x-goog-api-key'], 'test-key');
    assert.equal(request.redirect, 'error');
    const body = JSON.parse(request.body);
    assert.equal(body.contents[0].parts[0].text, 'Pickup at 3 pm');
    assert.equal(body.generationConfig.responseJsonSchema.additionalProperties, false);
    return Response.json({ candidates: [{ finishReason, content: { parts: [{ text: JSON.stringify(draft) }] } }] });
  };
  assert.deepEqual(await extractRoutine('Pickup at 3 pm', { key: 'test-key', fetcher: gemini({ fixedTime: '15:00' }) }), { fixedTime: '15:00' });
  await assert.rejects(extractRoutine('Pickup at 3 pm', { key: 'test-key', fetcher: gemini({ fixedTime: '25:00' }) }), /validation/);
  await assert.rejects(extractRoutine('Pickup at 3 pm', { key: 'test-key', fetcher: gemini({}, 'MAX_TOKENS') }), /complete draft/);
});

test('localized forecast route, static policy and unconfigured Gemini operate independently', async (t) => {
  const url = await launch(t, { forecast: async (city) => ({ city, mode: 'forecast' }) });
  assert.equal((await fetch(url)).status, 200);
  assert.match((await fetch(url, { method: 'HEAD' })).headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal((await fetch(`${url}/.env`)).status, 404);
  assert.equal((await fetch(`${url}/api/forecast?city=__proto__`)).status, 400);
  assert.equal((await (await fetch(`${url}/api/forecast?city=patna`)).json()).city, 'patna');
  assert.equal((await fetch(`${url}/api/routine`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"note":"Pickup at 3 pm"}' })).status, 503);
});

test('routine route bounds input, checks origin and limits shared model usage', async (t) => {
  let calls = 0;
  let now = timestamp;
  const url = await launch(t, { key: 'test-key', clock: () => now, extract: async () => { calls += 1; return { fixedTime: '15:00' }; } });
  const post = (body, extra = {}) => fetch(`${url}/api/routine`, { method: 'POST', headers: { 'content-type': 'application/json', ...extra }, body });
  assert.equal((await post('{"note":"pickup"}', { origin: 'https://example.com' })).status, 403);
  assert.equal((await post('{}')).status, 400);
  assert.equal((await post(JSON.stringify({ note: 'x'.repeat(4200) }))).status, 413);
  for (let index = 0; index < 40; index += 1) assert.equal((await post('{"note":"pickup"}')).status, 200);
  assert.equal((await post('{"note":"pickup"}')).status, 429);
  assert.equal(calls, 40);
  now += 3600_000;
  assert.deepEqual(await (await post('{"note":"pickup"}', { origin: url })).json(), { draft: { fixedTime: '15:00' } });
});

test('location endpoint rejects invalid and cross-origin input and sends rounded coordinates to the forecast service', async (t) => {
  const url = await launch(t, { forecast: async (position) => {
    assert.deepEqual(position, { lat: 19.1, lon: 72.9 });
    return { mode: 'forecast', city: null };
  } });
  const post = (body, extra = {}) => fetch(`${url}/api/location`, { method: 'POST', headers: { 'content-type': 'application/json', ...extra }, body: JSON.stringify(body) });
  assert.equal((await post({ lat: '19.076', lon: 72.8777 })).status, 400);
  assert.equal((await post({ lat: 91, lon: 72.8777 })).status, 400);
  assert.equal((await post({ lat: 19.076, lon: 72.8777 }, { origin: 'https://example.com' })).status, 403);
  const response = await post({ lat: 19.076, lon: 72.8777 });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { mode: 'forecast', city: null });
});
