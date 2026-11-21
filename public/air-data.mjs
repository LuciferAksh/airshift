import { cities } from './catalog.mjs';

const endpoint = 'https://air-quality-api.open-meteo.com/v1/air-quality';
const contributors = {
  us_aqi_pm2_5: 'PM₂.₅', us_aqi_pm10: 'PM₁₀', us_aqi_ozone: 'Ozone',
  us_aqi_nitrogen_dioxide: 'Nitrogen dioxide', us_aqi_sulphur_dioxide: 'Sulfur dioxide',
  us_aqi_carbon_monoxide: 'Carbon monoxide',
};
const currentFields = ['us_aqi', 'pm2_5', 'pm10', ...Object.keys(contributors)].join(',');
const nonNegative = (value) => Number.isFinite(value) && value >= 0;

export function parseCurrent(data) {
  if (!data || typeof data.time !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(data.time) || !nonNegative(data.us_aqi)) return null;
  let top = null;
  let highest = -1;
  for (const [key, label] of Object.entries(contributors)) {
    if (nonNegative(data[key]) && data[key] > highest) {
      top = label;
      highest = data[key];
    }
  }
  return { time: data.time, aqi: data.us_aqi, pm: nonNegative(data.pm2_5) ? data.pm2_5 : null, pm10: nonNegative(data.pm10) ? data.pm10 : null, top };
}

export function tomorrowAt(now, timeZone) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const date = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return new Date(Date.UTC(Number(date.year), Number(date.month) - 1, Number(date.day) + 1)).toISOString().slice(0, 10);
}

export function forecastLocation(location) {
  if (typeof location === 'string' && Object.hasOwn(cities, location)) {
    const { lat, lon } = cities[location];
    return { cacheKey: location, city: location, lat, lon, timezone: 'Asia/Kolkata' };
  }
  const { lat, lon } = location ?? {};
  if (![lat, lon].every(Number.isFinite) || Math.abs(lat) > 90 || Math.abs(lon) > 180) throw new RangeError('Invalid forecast location');
  const roundedLat = Number(lat.toFixed(1));
  const roundedLon = Number(lon.toFixed(1));
  return { cacheKey: `${roundedLat},${roundedLon}`, city: null, lat: roundedLat, lon: roundedLon, timezone: 'auto' };
}

export function parseForecast(data, city, date, fetchedAt, timezone = 'Asia/Kolkata') {
  const { time, pm2_5: pm, us_aqi: aqi } = data?.hourly ?? {};
  if (![time, pm, aqi].every(Array.isArray) || !['μg/m³', 'µg/m³'].includes(data?.hourly_units?.pm2_5)) {
    throw new Error('Unexpected forecast format');
  }
  const hours = Array.from({ length: 24 }, (_, hour) => {
    const stamp = `${date}T${String(hour).padStart(2, '0')}:00`;
    const index = time.indexOf(stamp);
    const numbers = [pm[index], aqi[index]];
    if (!numbers.every(nonNegative)) throw new Error('Incomplete forecast');
    return { time: hour, pm: pm[index], aqi: aqi[index] };
  });
  return { city, mode: 'forecast', date, hours, fetchedAt, timezone, current: parseCurrent(data.current) };
}

export async function fetchAirData({ city, lat, lon, timezone }, { fetcher = fetch, clock = Date.now, signal = AbortSignal.timeout(10000) } = {}) {
  const params = new URLSearchParams({ latitude: lat, longitude: lon, hourly: 'pm2_5,us_aqi', current: currentFields, timezone, forecast_days: '2' });
  const response = await fetcher(`${endpoint}?${params}`, { signal, credentials: 'omit' });
  if (!response.ok) throw new Error(`Forecast unavailable (${response.status})`);
  const data = await response.json();
  const localZone = timezone === 'auto' ? data.timezone : timezone;
  if (typeof localZone !== 'string' || !localZone) throw new Error('Forecast location has no timezone');
  const fetched = clock();
  return parseForecast(data, city, tomorrowAt(fetched, localZone), new Date(fetched).toISOString(), localZone);
}
