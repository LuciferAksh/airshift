import assert from 'node:assert/strict';
import test from 'node:test';
import { requestForecast } from '../public/forecast-client.mjs';

const tomorrow = '2026-11-27';
const providerWeather = {
  hourly_units: { pm2_5: 'µg/m³' },
  hourly: {
    time: Array.from({ length: 24 }, (_, time) => `${tomorrow}T${String(time).padStart(2, '0')}:00`),
    pm2_5: Array(24).fill(42),
    us_aqi: Array(24).fill(83),
  },
};
const localWeather = {
  city: 'delhi', mode: 'forecast', date: tomorrow, timezone: 'Asia/Kolkata',
  fetchedAt: '2026-11-26T10:00:00Z',
  current: { time: '2026-11-26T15:30', aqi: 83, pm: 0, pm10: null, top: 'PM₂.₅' },
  hours: Array.from({ length: 24 }, (_, time) => ({ time, pm: 42, aqi: 83 })),
};

test('forecast transport returns a valid local response without calling Open-Meteo', async () => {
  const signal = new AbortController().signal;
  const weather = await requestForecast(undefined, { signal, fetcher: async (url) => {
    assert.equal(url, '/api/forecast?city=delhi');
    return Response.json(localWeather);
  } });
  assert.deepEqual(weather, localWeather);
});

test('forecast transport falls back after incomplete same-origin data', async () => {
  const calls = [];
  const signal = new AbortController().signal;
  const weather = await requestForecast(undefined, {
    signal,
    clock: () => Date.parse(localWeather.fetchedAt),
    fetcher: async (url) => {
      calls.push(url);
      if (calls.length === 1) return Response.json({ ...localWeather, hours: [] });
      assert.equal(new URL(url).hostname, 'air-quality-api.open-meteo.com');
      return Response.json(providerWeather);
    },
  });
  assert.equal(calls.length, 2);
  assert.equal(weather.hours.length, 24);
  assert.equal(weather.hours[0].pm, 42);
});

test('browser-first forecast falls back to a rounded same-origin location request', async () => {
  const calls = [];
  const signal = new AbortController().signal;
  const result = await requestForecast({ lat: 19.076, lon: 72.8777 }, {
    signal, browserFirst: true, fetcher: async (url, options) => {
      calls.push(url);
      if (calls.length === 1) return new Response(null, { status: 503 });
      assert.equal(url, '/api/location');
      assert.deepEqual(JSON.parse(options.body), { lat: 19.1, lon: 72.9 });
      return Response.json({ ...localWeather, city: null, current: null });
    },
  });
  assert.equal(calls.length, 2);
  assert.equal(result.city, null);
});

test('forecast cancellation and client errors prevent an unwanted fallback', async () => {
  const controller = new AbortController();
  let calls = 0;
  await assert.rejects(requestForecast(undefined, { signal: controller.signal, fetcher: async () => {
    calls += 1;
    controller.abort();
    return Response.error();
  } }), { name: 'AbortError' });
  assert.equal(calls, 1);

  const signal = new AbortController().signal;
  await assert.rejects(requestForecast(undefined, { signal, fetcher: async (url) => {
    assert.equal(url, '/api/forecast?city=delhi');
    return Response.json({ error: 'Location lookups are busy.' }, { status: 429 });
  } }), /Location lookups are busy/);
});

test('invalid current conditions fall back to a clear error if the provider also fails', async () => {
  const signal = new AbortController().signal;
  await assert.rejects(requestForecast(undefined, { signal, fetcher: async (url) => {
    if (url.startsWith('/')) return Response.json({ ...localWeather, current: { ...localWeather.current, pm: 'high' } });
    return new Response(null, { status: 503 });
  } }), /switch to the labeled sample/);
});
