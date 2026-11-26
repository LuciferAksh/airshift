import { fetchAirData, forecastLocation } from './air-data.mjs';
import { cities } from './catalog.mjs';
import { hasKey, isRecord } from './validation.mjs';

export const DEFAULT_CITY = 'delhi';
const FORECAST_ERROR = 'Forecast unavailable. Try another location or switch to the labeled sample.';

/**
 * @param {import('../types/airshift.js').Coordinates | undefined} location
 * @param {{signal: AbortSignal, browserFirst?: boolean, fetcher?: typeof fetch, clock?: () => number}} options
 * @returns {Promise<import('../types/airshift.js').LiveForecast>}
 */
export async function requestForecast(location, { signal, browserFirst = false, fetcher = fetch, clock = Date.now }) {
  const target = forecastLocation(location ?? DEFAULT_CITY);

  async function fromProvider() {
    const deadline = AbortSignal.any([signal, AbortSignal.timeout(10_000)]);
    try {
      return await fetchAirData(target, { fetcher, signal: deadline, clock });
    } catch {
      signal.throwIfAborted();
      return null;
    }
  }

  signal.throwIfAborted();
  if (browserFirst) {
    const forecast = await fromProvider();
    if (forecast) return forecast;
  }

  const url = location ? '/api/location' : `/api/forecast?city=${DEFAULT_CITY}`;
  const request = location ? {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lat: target.lat, lon: target.lon }),
  } : {};
  // Each transport gets its own deadline so a failing primary cannot consume the fallback's time.
  const localSignal = AbortSignal.any([signal, AbortSignal.timeout(12_000)]);
  const response = await fetcher(url, { ...request, signal: localSignal }).catch(() => null);
  signal.throwIfAborted();
  if (response && response.status < 500) {
    const data = /** @type {unknown} */ (await response.json().catch(() => null));
    signal.throwIfAborted();
    if (response.ok && isLiveForecast(data)) return data;
    if (!response.ok) throw new Error(isRecord(data) && typeof data.error === 'string' ? data.error : FORECAST_ERROR);
  }
  if (!browserFirst) {
    const forecast = await fromProvider();
    if (forecast) return forecast;
  }
  throw new Error(FORECAST_ERROR);
}

/** @param {unknown} value @returns {value is import('../types/airshift.js').LiveForecast} */
function isLiveForecast(value) {
  if (!isRecord(value) || value.mode !== 'forecast' || (value.city !== null && !hasKey(cities, value.city))
    || (value.cityLabel !== undefined && typeof value.cityLabel !== 'string') || typeof value.date !== 'string'
    || typeof value.timezone !== 'string' || typeof value.fetchedAt !== 'string'
    || !Number.isFinite(Date.parse(value.fetchedAt)) || !Array.isArray(value.hours) || value.hours.length !== 24) return false;
  if (!value.hours.every((hour, time) => isRecord(hour) && hour.time === time
    && typeof hour.pm === 'number' && Number.isFinite(hour.pm) && hour.pm >= 0
    && typeof hour.aqi === 'number' && Number.isFinite(hour.aqi) && hour.aqi >= 0)) return false;
  const current = value.current;
  return current === null || (isRecord(current) && typeof current.time === 'string'
    && typeof current.aqi === 'number' && Number.isFinite(current.aqi)
    && (current.pm === null || Number.isFinite(current.pm))
    && (current.pm10 === null || Number.isFinite(current.pm10))
    && (current.top === null || typeof current.top === 'string'));
}
