import { fetchAirData, forecastLocation, tomorrowAt } from '../public/air-data.mjs';

const freshFor = 15 * 60_000;
const maxLocations = 64;

/** @param {typeof fetch} [fetcher] @param {() => number} [clock] */
export function forecastService(fetcher = fetch, clock = Date.now) {
  /** @type {Map<string, {expires: number, request: Promise<import('../types/airshift.js').LiveForecast>}>} */
  const cache = new Map();
  /** @param {import('../types/airshift.js').CityId | import('../types/airshift.js').Coordinates} location */
  return async function getForecast(location) {
    const target = forecastLocation(location);
    const { cacheKey } = target;
    const now = clock();
    const existing = cache.get(cacheKey);
    if (existing && now < existing.expires) {
      const cached = await existing.request;
      if (cached.date === tomorrowAt(clock(), cached.timezone)) return cached;

      // A second reader can resume here after the first has started the new forecast.
      const replacement = cache.get(cacheKey);
      if (replacement && replacement !== existing) return replacement.request;
    }

    const request = fetchAirData(target, { fetcher, clock });
    if (cache.size >= maxLocations && !cache.has(cacheKey)) {
      const oldest = cache.keys().next();
      if (!oldest.done) cache.delete(oldest.value);
    }
    cache.set(cacheKey, { expires: now + freshFor, request });
    try {
      return await request;
    } catch (error) {
      if (cache.get(cacheKey)?.request === request) cache.delete(cacheKey);
      throw error;
    }
  };
}
