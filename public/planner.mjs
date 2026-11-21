import { activities, audiences, cities, flexibleActivity, indoorActions, travelOptions } from './catalog.mjs';

export const timePattern = '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$';
const timeMatch = new RegExp(timePattern);

export function toMinutes(time) {
  if (typeof time !== 'string' || !timeMatch.test(time)) return NaN;
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

export function formatTime(minutes) {
  const hours = String(Math.floor(minutes / 60)).padStart(2, '0');
  return `${hours}:${String(minutes % 60).padStart(2, '0')}`;
}

const integer = (min, max) => ({ type: 'integer', minimum: min, maximum: max });
const choice = (options) => ({ type: 'string', enum: Object.keys(options) });
const time = { type: 'string', pattern: timePattern };
const toggle = { type: 'boolean' };

export const draftFields = Object.freeze({
  activity: choice(activities), fixedTime: time, fixedMinutes: integer(5, 180), usualTime: time,
  earliest: time, latest: time, minutes: integer(5, 180), sensitive: toggle,
  indoorAvailable: toggle, purifier: toggle, travel: choice(travelOptions),
  indoorAction: choice(indoorActions), distance: { type: 'number', minimum: 0, maximum: 200 },
});

export function validDraft(draft) {
  if (!draft || typeof draft !== 'object' || Array.isArray(draft)) return false;
  return Object.entries(draft).every(([key, value]) => {
    if (!Object.hasOwn(draftFields, key)) return false;
    const field = draftFields[key];
    if (field.enum) return field.enum.includes(value);
    if (field.pattern) return Number.isFinite(toMinutes(value));
    if (field.type === 'boolean') return typeof value === 'boolean';
    if (field.type === 'integer' && !Number.isInteger(value)) return false;
    return Number.isFinite(value) && value >= field.minimum && value <= field.maximum;
  });
}

export function validateProfile(profile) {
  const { audience, ...fields } = profile;
  if (!Object.hasOwn(audiences, audience) || !validDraft(fields) || Object.keys(fields).length !== Object.keys(draftFields).length) {
    return 'Check the times, outdoor minutes (5–180) and travel distance (0–200 km).';
  }
  if (toMinutes(profile.fixedTime) + profile.fixedMinutes > 1440 || toMinutes(profile.usualTime) + profile.minutes > 1440) {
    return 'Both activities must end on the same day.';
  }
  if (toMinutes(profile.earliest) + profile.minutes > toMinutes(profile.latest)) {
    return 'The flexible window must fit the full activity before its latest finish.';
  }
  if (profile.indoorAction === 'filter' && !profile.purifier) return 'Confirm you have a portable filter or choose a no-cost action.';
  return '';
}

export const aqiBand = (aqi) => {
  if (aqi > 300) return { label: 'Hazardous', tone: 'hazard' };
  if (aqi > 200) return { label: 'Very unhealthy', tone: 'very' };
  if (aqi > 150) return { label: 'Unhealthy', tone: 'high' };
  if (aqi > 100) return { label: 'Unhealthy for sensitive groups', tone: 'sensitive' };
  if (aqi > 50) return { label: 'Moderate', tone: 'moderate' };
  return { label: 'Good', tone: 'good' };
};

export function sampleForecast(city) {
  if (!Object.hasOwn(cities, city)) throw new RangeError('Unknown city');
  const pm = [155, 162, 167, 177, 190, 201, 224, 240, 236, 198, 161, 122, 98, 79, 72, 85, 104, 134, 173, 202, 220, 221, 205, 186];
  const aqi = [211, 217, 221, 230, 241, 250, 269, 283, 279, 248, 216, 191, 181, 174, 171, 176, 184, 196, 226, 251, 266, 267, 254, 237];
  const offset = { delhi: 0, noida: 9, lucknow: -13, patna: -5 }[city];
  return {
    city, mode: 'sample', date: null, timezone: 'IST',
    current: { time: '09:00', aqi: aqi[9] + offset, pm: pm[9] + offset, pm10: 251 + offset, top: 'PM₂.₅' },
    hours: pm.map((value, hour) => ({ time: hour, pm: value + offset, aqi: aqi[hour] + offset })),
  };
}

function interval(hours, start, duration) {
  const end = start + duration;
  let area = 0;
  let peak = 0;
  for (let hour = Math.floor(start / 60); hour * 60 < end; hour += 1) {
    const point = hours[hour];
    if (!point) return null;
    const minutes = Math.min(end, (hour + 1) * 60) - Math.max(start, hour * 60);
    area += point.pm * minutes / 60;
    peak = Math.max(point.aqi, peak);
  }
  return { start, area, peak, meanPm: area * 60 / duration };
}

function bestWindow(hours, profile, fixed, usual, maxAqi, alternativeTo) {
  let best = null;
  const earliest = toMinutes(profile.earliest);
  const latest = toMinutes(profile.latest) - profile.minutes;
  for (let start = earliest; start <= latest; start += 1) {
    if (start < fixed.start + profile.fixedMinutes && start + profile.minutes > fixed.start) continue;
    const candidate = interval(hours, start, profile.minutes);
    if (!candidate || candidate.peak > maxAqi) continue;
    if (alternativeTo && (Math.abs(start - alternativeTo.start) < 45 || candidate.area > Math.min(usual.area, alternativeTo.area * 1.2) + 1e-9)) continue;
    const difference = best ? candidate.area - best.area : -Infinity;
    const closerToUsual = best && Math.abs(start - usual.start) < Math.abs(best.start - usual.start);
    const preferred = alternativeTo ? !best || closerToUsual : difference < -1e-9 || (Math.abs(difference) <= 1e-9 && closerToUsual);
    if (preferred) {
      best = candidate;
    }
  }
  return best;
}

export function makePlan(profile, forecast, selection) {
  const error = validateProfile(profile);
  if (error) throw new RangeError(error);
  const fixed = interval(forecast.hours, toMinutes(profile.fixedTime), profile.fixedMinutes);
  const usual = interval(forecast.hours, toMinutes(profile.usualTime), profile.minutes);
  if (!fixed || !usual) throw new RangeError('Hourly forecast is incomplete for these activities.');

  const active = profile.audience === 'community' || activities[profile.activity].strenuous;
  const maxAqi = active ? (profile.sensitive ? 100 : 150) : (profile.sensitive ? 200 : 300);
  const lowest = bestWindow(forecast.hours, profile, fixed, usual, maxAqi);
  const closer = lowest && bestWindow(forecast.hours, profile, fixed, usual, maxAqi, lowest);
  const best = selection?.schedule === 'closer' && closer ? closer : lowest;
  const moveInside = active && profile.indoorAvailable;
  const decision = best ? (best.start === usual.start ? 'keep' : 'shift') : (moveInside && selection?.schedule !== 'defer' ? 'indoors' : 'defer');
  const comparison = best ? { before: usual.area, after: best.area, change: usual.area ? 100 * (usual.area - best.area) / usual.area : null } : null;

  return {
    fixed, usual, best, lowest, closer, decision, maxAqi, comparison,
    outdoorMinutesAvoided: best ? 0 : profile.minutes,
    carKmAvoided: profile.travel === 'none' ? 0 : profile.distance,
    indoor: indoorActions[selection?.indoor ?? profile.indoorAction],
  };
}

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
