import { fetchAirData, forecastLocation, tomorrowAt } from '../public/air-data.mjs';

const freshFor = 15 * 60_000;
const maxLocations = 64;

export function forecastService(fetcher = fetch, clock = Date.now) {
  const cache = new Map();
  return async function getForecast(location) {
    const target = forecastLocation(location);
    const { cacheKey } = target;
    const now = clock();
    const existing = cache.get(cacheKey);
    if (existing && now < existing.expires) {
      const cached = await existing.request;
      if (cached.date === tomorrowAt(now, cached.timezone)) return cached;
    }

    const request = fetchAirData(target, { fetcher, clock });
    if (cache.size >= maxLocations && !cache.has(cacheKey)) cache.delete(cache.keys().next().value);
    cache.set(cacheKey, { expires: now + freshFor, request });
    try {
      return await request;
    } catch (error) {
      if (cache.get(cacheKey)?.request === request) cache.delete(cacheKey);
      throw error;
    }
  };
}
