import { cities } from '../public/catalog.mjs';
import { forecastLocation } from '../public/air-data.mjs';
import { recommendationContext, validRecommendationInput } from '../public/recommendations.mjs';
import { forecastService } from './forecast.mjs';
import { extractRoutine, rankRecommendations } from './gemini.mjs';
import { hasKey, isRecord } from '../public/validation.mjs';

/** @typedef {{key?: string, model?: string}} ModelSettings */
/** @typedef {{forecast?: ReturnType<typeof forecastService>, extract?: typeof extractRoutine, rank?: typeof rankRecommendations, clock?: () => number}} HandlerOptions */
/** @typedef {Record<string, {type: string, content: Uint8Array<ArrayBuffer>}>} AssetMap */

export const files = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/styles.css': ['styles.css', 'text/css; charset=utf-8'],
  '/app.mjs': ['app.mjs', 'text/javascript; charset=utf-8'],
  '/dom.mjs': ['dom.mjs', 'text/javascript; charset=utf-8'],
  '/validation.mjs': ['validation.mjs', 'text/javascript; charset=utf-8'],
  '/forecast-ui.mjs': ['forecast-ui.mjs', 'text/javascript; charset=utf-8'],
  '/forecast-client.mjs': ['forecast-client.mjs', 'text/javascript; charset=utf-8'],
  '/plan-view.mjs': ['plan-view.mjs', 'text/javascript; charset=utf-8'],
  '/routine-ui.mjs': ['routine-ui.mjs', 'text/javascript; charset=utf-8'],
  '/air-data.mjs': ['air-data.mjs', 'text/javascript; charset=utf-8'],
  '/chart.mjs': ['chart.mjs', 'text/javascript; charset=utf-8'],
  '/catalog.mjs': ['catalog.mjs', 'text/javascript; charset=utf-8'],
  '/planner.mjs': ['planner.mjs', 'text/javascript; charset=utf-8'],
  '/recommendations.mjs': ['recommendations.mjs', 'text/javascript; charset=utf-8'],
  '/recommendations-ui.mjs': ['recommendations-ui.mjs', 'text/javascript; charset=utf-8'],
  '/places.mjs': ['places.mjs', 'text/javascript; charset=utf-8'],
  '/winter-city.jpg': ['winter-city.jpg', 'image/jpeg'],
  '/icon.png': ['icon.png', 'image/png'],
};

const headers = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'geolocation=(self)',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; connect-src 'self' https://air-quality-api.open-meteo.com https://geocoding-api.open-meteo.com; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
};

/** @param {number} status @param {object} value */
const json = (status, value) => Response.json(value, { status, headers: { ...headers, 'Cache-Control': 'no-store' } });

/** @param {Request} request @param {number} maximum @returns {Promise<unknown>} */
async function readJson(request, maximum) {
  if (!request.body) throw new TypeError('Request body required');
  const reader = request.body.getReader();
  const bytes = new Uint8Array(maximum);
  let written = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (written + value.length > maximum) {
        void reader.cancel().catch(() => {});
        throw new RangeError('Request too large');
      }
      bytes.set(value, written);
      written += value.length;
    }
  } finally { reader.releaseLock(); }
  return JSON.parse(new TextDecoder().decode(bytes.subarray(0, written)));
}

/** @param {number} limit @param {number} interval @param {() => number} clock */
function quota(limit, interval, clock) {
  /** @type {number[]} */
  const requests = [];
  return () => {
    const now = clock();
    while (requests.length && requests[0] <= now - interval) requests.shift();
    if (requests.length >= limit) return false;
    requests.push(now);
    return true;
  };
}

/** @param {Request} request */
function checkPost(request) {
  const site = request.headers.get('sec-fetch-site');
  const origin = request.headers.get('origin');
  const host = new URL(request.url).host;
  if ((site && site !== 'same-origin') || (origin && origin !== `https://${host}` && origin !== `http://${host}`)) {
    return json(403, { error: 'Use the assistant from this site.' });
  }
  if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') {
    return json(415, { error: 'Expected a JSON request.' });
  }
  return null;
}

/** @param {Request} request @param {ModelSettings} config @param {typeof extractRoutine} extract @param {() => boolean} takeRequest */
async function suggest(request, config, extract, takeRequest) {
  const invalid = checkPost(request);
  if (invalid) return invalid;
  if (!config.key) return json(503, { error: 'Gemini is unavailable here. You can still edit the plan directly.' });

  let note;
  try {
    const body = await readJson(request, 4096);
    if (!isRecord(body) || typeof body.note !== 'string' || Object.keys(body).length !== 1) throw new TypeError('Invalid routine');
    note = body.note.trim();
    if (!note || note.length > 600) throw new TypeError('Invalid routine');
  } catch (error) { return json(error instanceof RangeError ? 413 : 400, { error: 'Enter a routine of 1–600 characters.' }); }
  if (!takeRequest()) return json(429, { error: 'Gemini has reached its shared limit. Edit the plan directly or try again later.' });

  try { return json(200, { draft: await extract(note, { key: config.key, model: config.model }) }); }
  catch { return json(502, { error: 'Gemini could not read the routine. You can still edit the plan directly.' }); }
}

/** @param {Request} request @param {ModelSettings} config @param {typeof rankRecommendations} rank @param {() => boolean} takeRequest */
async function recommend(request, config, rank, takeRequest) {
  const invalid = checkPost(request);
  if (invalid) return invalid;
  if (!config.key) return json(503, { error: 'Gemini is unavailable. The forecast-based plan remains available.' });
  let input;
  try { input = await readJson(request, 4096); }
  catch (error) { return json(error instanceof RangeError ? 413 : 400, { error: 'Invalid recommendation request.' }); }
  if (!validRecommendationInput(input)) return json(400, { error: 'Refresh the forecast and check your routine settings.' });
  if (!takeRequest()) return json(429, { error: 'Gemini has reached its shared limit. The forecast-based plan remains available.' });
  try { return json(200, { recommendation: await rank(recommendationContext(input), { key: config.key, model: config.model }) }); }
  catch { return json(502, { error: 'Gemini could not personalize this plan. The forecast-based plan remains available.' }); }
}

/** @param {ReturnType<typeof forecastService>} forecast @param {Parameters<ReturnType<typeof forecastService>>[0]} location */
async function provideForecast(forecast, location) {
  try { return json(200, await forecast(location)); }
  catch (error) {
    const known = /^(?:Forecast unavailable \(\d{3}\)|Forecast location has no timezone|Unexpected forecast format|Incomplete forecast)$/;
    const message = error instanceof Error ? error.message : '';
    const reason = known.test(message) ? message : error instanceof Error && error.name === 'TimeoutError' ? 'Timeout' : 'Network or runtime failure';
    console.warn('Forecast provider:', reason);
    return json(503, { error: 'The forecast provider is unavailable. Try another location or switch to the labeled sample.' });
  }
}

/** @param {Request} request @param {ReturnType<typeof forecastService>} forecast @param {() => boolean} takeRequest */
async function detectForecast(request, forecast, takeRequest) {
  const invalid = checkPost(request);
  if (invalid) return invalid;
  let position;
  try {
    const input = await readJson(request, 256);
    if (!isRecord(input) || Object.keys(input).length !== 2) throw new TypeError('Invalid position');
    const { lat, lon } = forecastLocation({ lat: input.lat, lon: input.lon });
    position = { lat, lon };
  } catch { return json(400, { error: 'Location missing or invalid. Choose a city or try again.' }); }
  if (!takeRequest()) return json(429, { error: 'Location lookups are busy. Choose a city or try again shortly.' });
  return provideForecast(forecast, position);
}

/** @param {AssetMap} assets @param {HandlerOptions} [options] */
export function webApp(assets, { forecast = forecastService(), extract = extractRoutine, rank = rankRecommendations, clock = Date.now } = {}) {
  const takeAiRequest = quota(40, 3600_000, clock);
  const takeLocationRequest = quota(120, 60_000, clock);

  /** @param {Request} request @param {ModelSettings} config */
  return async (request, config) => {
    const url = new URL(request.url);
    if (url.pathname === '/api/routine' && request.method === 'POST') return suggest(request, config, extract, takeAiRequest);
    if (url.pathname === '/api/recommendations' && request.method === 'POST') return recommend(request, config, rank, takeAiRequest);
    if (url.pathname === '/api/location' && request.method === 'POST') return detectForecast(request, forecast, takeLocationRequest);
    if (url.pathname === '/api/forecast' && request.method === 'GET') {
      const city = url.searchParams.get('city');
      if (!hasKey(cities, city)) return json(400, { error: 'Choose a supported city.' });
      return provideForecast(forecast, city);
    }
    const asset = Object.hasOwn(assets, url.pathname) ? assets[url.pathname] : null;
    if (asset && ['HEAD', 'GET'].includes(request.method)) {
      return new Response(request.method === 'GET' ? asset.content : null, { headers: { ...headers, 'Content-Type': asset.type } });
    }
    return json(404, { error: 'Page not found.' });
  };
}
