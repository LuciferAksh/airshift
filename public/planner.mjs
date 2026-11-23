import { activities, audiences, cities, flexibleActivity, indoorActions, travelOptions } from './catalog.mjs';
import { hasKey, isRecord } from './validation.mjs';

/** @typedef {import('../types/airshift.js').Profile} Profile */
/** @typedef {import('../types/airshift.js').Forecast} Forecast */
/** @typedef {import('../types/airshift.js').Interval} Interval */
/** @typedef {{type: 'string', enum: string[]} | {type: 'string', pattern: string} | {type: 'integer' | 'number', minimum: number, maximum: number} | {type: 'boolean'}} FieldRule */

const MINUTES_PER_HOUR = 60;
const MINUTES_PER_DAY = 24 * MINUTES_PER_HOUR;
const EXPOSURE_PRECISION = 1e-9;
const ALTERNATIVE_MINUTES_APART = 45;
const ALTERNATIVE_MAX_EXPOSURE_RATIO = 1.2;

export const timePattern = '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$';
const timeMatch = new RegExp(timePattern);

/** @param {unknown} time */
export function toMinutes(time) {
  if (typeof time !== 'string' || !timeMatch.test(time)) return NaN;
  const [hours, minutes] = time.split(':').map(Number);
  return hours * MINUTES_PER_HOUR + minutes;
}

/** @param {number} minutes */
export function formatTime(minutes) {
  const hours = String(Math.floor(minutes / MINUTES_PER_HOUR)).padStart(2, '0');
  return `${hours}:${String(minutes % MINUTES_PER_HOUR).padStart(2, '0')}`;
}

/** @param {number} min @param {number} max @returns {FieldRule} */
const integer = (min, max) => ({ type: 'integer', minimum: min, maximum: max });
/** @param {object} options @returns {FieldRule} */
const choice = (options) => ({ type: 'string', enum: Object.keys(options) });
/** @type {FieldRule} */
const time = { type: 'string', pattern: timePattern };
/** @type {FieldRule} */
const toggle = { type: 'boolean' };

/** @type {Readonly<Record<keyof import('../types/airshift.js').RoutineDraft, FieldRule>>} */
export const draftFields = Object.freeze({
  activity: choice(activities), fixedTime: time, fixedMinutes: integer(5, 180), usualTime: time,
  earliest: time, latest: time, minutes: integer(5, 180), sensitive: toggle,
  indoorAvailable: toggle, purifier: toggle, travel: choice(travelOptions),
  indoorAction: choice(indoorActions), distance: { type: 'number', minimum: 0, maximum: 200 },
});

/** @param {string} key @param {unknown} value */
function validField(key, value) {
  if (!hasKey(draftFields, key)) return false;
  const field = draftFields[key];
  if ('enum' in field) return typeof value === 'string' && field.enum.includes(value);
  if ('pattern' in field) return Number.isFinite(toMinutes(value));
  if (field.type === 'boolean') return typeof value === 'boolean';
  if (field.type === 'integer' && !Number.isInteger(value)) return false;
  return typeof value === 'number' && Number.isFinite(value) && value >= field.minimum && value <= field.maximum;
}

/** @param {unknown} draft @returns {draft is import('../types/airshift.js').RoutineDraft} */
export function validDraft(draft) {
  return isRecord(draft) && Object.entries(draft).every(([key, value]) => validField(key, value));
}

/** @param {unknown} profile @returns {import('../types/airshift.js').ProfileIssue | null} */
export function profileIssue(profile) {
  if (!isRecord(profile)) return { field: null, message: 'Provide a routine with valid settings.' };
  const { audience, ...fields } = profile;
  if (!hasKey(audiences, audience)) {
    return { field: 'audience', message: 'Choose a household or community group.' };
  }
  for (const key of Object.keys(draftFields)) {
    if (!hasKey(draftFields, key)) continue;
    if (validField(key, fields[key])) continue;
    const rule = draftFields[key];
    if ('pattern' in rule) return { field: key, message: 'Enter a valid start or finish time.' };
    if (key === 'distance') return { field: key, message: 'Enter a distance from 0 to 200 km.' };
    if (rule.type === 'integer') return { field: key, message: 'Enter a whole number from 5 to 180 minutes.' };
    return { field: key, message: 'Choose a supported option.' };
  }
  if (Object.keys(fields).length !== Object.keys(draftFields).length) {
    return { field: null, message: 'The routine contains an unsupported setting.' };
  }
  const settings = /** @type {Profile & Record<string, unknown>} */ (profile);
  if (toMinutes(settings.fixedTime) + settings.fixedMinutes > MINUTES_PER_DAY) {
    return { field: 'fixedTime', message: 'The fixed commitment must end on the same day.' };
  }
  if (toMinutes(settings.usualTime) + settings.minutes > MINUTES_PER_DAY) {
    return { field: 'usualTime', message: 'The flexible activity must end on the same day.' };
  }
  if (toMinutes(settings.earliest) + settings.minutes > toMinutes(settings.latest)) {
    return { field: 'latest', message: 'The flexible window must fit the full activity before its latest finish.' };
  }
  if (settings.indoorAction === 'filter' && !settings.purifier) {
    return { field: 'indoorAction', message: 'Confirm you have a portable filter or choose a no-cost action.' };
  }
  return null;
}

/** @param {unknown} profile @returns {profile is Profile} */
export function isProfile(profile) {
  return profileIssue(profile) === null;
}

/** @param {unknown} profile */
export function validateProfile(profile) {
  return profileIssue(profile)?.message ?? '';
}

/** @param {number} aqi */
export const aqiBand = (aqi) => {
  if (aqi > 300) return { label: 'Hazardous', tone: 'hazard' };
  if (aqi > 200) return { label: 'Very unhealthy', tone: 'very' };
  if (aqi > 150) return { label: 'Unhealthy', tone: 'high' };
  if (aqi > 100) return { label: 'Unhealthy for sensitive groups', tone: 'sensitive' };
  if (aqi > 50) return { label: 'Moderate', tone: 'moderate' };
  return { label: 'Good', tone: 'good' };
};

/** @param {import('../types/airshift.js').CityId} city @returns {Forecast} */
export function sampleForecast(city) {
  if (!hasKey(cities, city)) throw new RangeError('Unknown city');
  const pm = [155, 162, 167, 177, 190, 201, 224, 240, 236, 198, 161, 122, 98, 79, 72, 85, 104, 134, 173, 202, 220, 221, 205, 186];
  const aqi = [211, 217, 221, 230, 241, 250, 269, 283, 279, 248, 216, 191, 181, 174, 171, 176, 184, 196, 226, 251, 266, 267, 254, 237];
  const offset = { delhi: 0, noida: 9, lucknow: -13, patna: -5 }[city];
  return {
    city, mode: 'sample', date: null, timezone: 'IST',
    current: { time: '09:00', aqi: aqi[9] + offset, pm: pm[9] + offset, pm10: 251 + offset, top: 'PM₂.₅' },
    hours: pm.map((value, hour) => ({ time: hour, pm: value + offset, aqi: aqi[hour] + offset })),
  };
}

/** @param {Forecast['hours']} hours @param {number} start @param {number} duration @returns {Interval | null} */
function interval(hours, start, duration) {
  const end = start + duration;
  let area = 0;
  let peak = 0;
  for (let hour = Math.floor(start / MINUTES_PER_HOUR); hour * MINUTES_PER_HOUR < end; hour += 1) {
    const point = hours[hour];
    if (!point) return null;
    const minutes = Math.min(end, (hour + 1) * MINUTES_PER_HOUR) - Math.max(start, hour * MINUTES_PER_HOUR);
    area += point.pm * minutes / MINUTES_PER_HOUR;
    peak = Math.max(point.aqi, peak);
  }
  return { start, area, peak, meanPm: area * MINUTES_PER_HOUR / duration };
}

/** @param {Forecast['hours']} hours @param {Profile} profile @param {Interval} fixed @param {number} maxAqi */
function eligibleWindows(hours, profile, fixed, maxAqi) {
  const windows = [];
  const earliest = toMinutes(profile.earliest);
  const latest = toMinutes(profile.latest) - profile.minutes;
  const fixedEnd = fixed.start + profile.fixedMinutes;
  for (let start = earliest; start <= latest; start += 1) {
    if (start < fixedEnd && start + profile.minutes > fixed.start) continue;
    const candidate = interval(hours, start, profile.minutes);
    if (candidate && candidate.peak <= maxAqi) windows.push(candidate);
  }
  return windows;
}

/** @param {Interval[]} windows @param {Interval} usual @returns {Interval | null} */
function lowestExposure(windows, usual) {
  let lowest = null;
  for (const candidate of windows) {
    if (!lowest) {
      lowest = candidate;
      continue;
    }
    const difference = candidate.area - lowest.area;
    const closerToUsual = Math.abs(candidate.start - usual.start) < Math.abs(lowest.start - usual.start);
    if (difference < -EXPOSURE_PRECISION || (Math.abs(difference) <= EXPOSURE_PRECISION && closerToUsual)) lowest = candidate;
  }
  return lowest;
}

/** @param {Interval[]} windows @param {Interval} usual @param {Interval} lowest @returns {Interval | null} */
function closerToUsual(windows, usual, lowest) {
  const exposureLimit = Math.min(usual.area, lowest.area * ALTERNATIVE_MAX_EXPOSURE_RATIO) + EXPOSURE_PRECISION;
  let closer = null;
  let shortestShift = Infinity;
  for (const candidate of windows) {
    if (Math.abs(candidate.start - lowest.start) < ALTERNATIVE_MINUTES_APART || candidate.area > exposureLimit) continue;
    const shift = Math.abs(candidate.start - usual.start);
    if (shift < shortestShift) {
      closer = candidate;
      shortestShift = shift;
    }
  }
  return closer;
}

/** @param {Profile} profile @param {Pick<Forecast, 'hours'>} forecast @param {import('../types/airshift.js').Recommendation | null} [selection] */
export function makePlan(profile, forecast, selection) {
  const error = validateProfile(profile);
  if (error) throw new RangeError(error);
  const fixed = interval(forecast.hours, toMinutes(profile.fixedTime), profile.fixedMinutes);
  const usual = interval(forecast.hours, toMinutes(profile.usualTime), profile.minutes);
  if (!fixed || !usual) throw new RangeError('Hourly forecast is incomplete for these activities.');

  const active = profile.audience === 'community' || activities[profile.activity].strenuous;
  const maxAqi = active ? (profile.sensitive ? 100 : 150) : (profile.sensitive ? 200 : 300);
  const windows = eligibleWindows(forecast.hours, profile, fixed, maxAqi);
  const lowest = lowestExposure(windows, usual);
  const closer = lowest && closerToUsual(windows, usual, lowest);
  const best = selection?.schedule === 'closer' && closer ? closer : lowest;
  const moveInside = active && profile.indoorAvailable;
  const decision = best ? (best.start === usual.start ? 'keep' : 'shift') : (moveInside && selection?.schedule !== 'defer' ? 'indoors' : 'defer');
  const comparison = best ? { before: usual.area, after: best.area, change: usual.area ? 100 * (usual.area - best.area) / usual.area : null } : null;
  const travel = selection?.travel ?? profile.travel;
  const carKmAvoided = travel !== 'none' && travel === profile.travel ? profile.distance : 0;

  return {
    fixed, usual, best, lowest, closer, decision, maxAqi, comparison,
    outdoorMinutesAvoided: best ? 0 : profile.minutes,
    travel,
    carKmAvoided,
    indoor: indoorActions[selection?.indoor ?? profile.indoorAction],
  };
}

/** @param {Profile} profile @param {Forecast} forecast @param {ReturnType<typeof makePlan>} plan */
export function activityNotice(profile, forecast, plan) {
  const city = forecast.cityLabel ?? (forecast.city ? cities[forecast.city].name : 'Local area');
  const timezone = ['IST', 'Asia/Kolkata', 'Asia/Calcutta'].includes(forecast.timezone) ? 'IST' : forecast.timezone;
  const date = forecast.mode === 'sample' ? 'Sample winter day — demonstration only' : `${forecast.date} (${timezone}) — Open-Meteo / CAMS regional forecast`;
  const label = flexibleActivity(profile);
  const decision = plan.best ? `${label}: ${formatTime(plan.best.start)} (${timezone}). Forecast peak US AQI ${Math.round(plan.best.peak)} during the activity.`
    : plan.decision === 'indoors' ? `${label}: use the confirmed indoor option if local guidance and the venue’s air conditions allow.`
      : `${label}: postpone and check the forecast again.`;
  const advisory = timezone === 'IST' ? ' https://app.cpcbccr.com/AQIIndia' : '';
  return `${city} · ${date}\n${decision}\nCheck local advisories before leaving.${advisory}`;
}
