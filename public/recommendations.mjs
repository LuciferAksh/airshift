import { flexibleActivity, indoorActions, travelOptions } from './catalog.mjs';
import { formatTime, makePlan, validateProfile } from './planner.mjs';

const priorities = ['exposure', 'schedule', 'travel'];
const concerns = ['unknown', 'smoke', 'cooking', 'dust'];

function isRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

export function validRecommendationInput(value) {
  if (!isRecord(value) || Object.keys(value).length !== 4) return false;
  const { profile, preferences, hours, mode } = value;
  if (!isRecord(profile) || validateProfile(profile) || !isRecord(preferences) || Object.keys(preferences).length !== 4) return false;
  if (!priorities.includes(preferences.priority) || !concerns.includes(preferences.concern) || typeof preferences.rail !== 'boolean' || typeof preferences.combine !== 'boolean') return false;
  return ['sample', 'forecast'].includes(mode) && Array.isArray(hours) && hours.length === 24 && hours.every((point, time) => (
    isRecord(point) && Object.keys(point).length === 3 && point.time === time
    && Number.isFinite(point.pm) && point.pm >= 0 && point.pm <= 10000
    && Number.isFinite(point.aqi) && point.aqi >= 0 && point.aqi <= 2000
  ));
}

function intervalSummary(interval, duration) {
  return { start: formatTime(interval.start), end: formatTime(interval.start + duration), peakUsAqi: Math.round(interval.peak), outdoorParticleIndex: Number(interval.area.toFixed(2)) };
}

export function recommendationContext({ profile, preferences, hours, mode }) {
  const plan = makePlan(profile, { hours, mode });
  const schedule = {};
  if (plan.lowest) schedule.lowest = intervalSummary(plan.lowest, profile.minutes);
  if (plan.closer) schedule.closer = intervalSummary(plan.closer, profile.minutes);
  if (!plan.lowest && plan.decision === 'indoors') schedule.indoors = 'Use the confirmed indoor alternative';
  if (!plan.lowest) schedule.defer = 'Postpone the optional outdoor activity';

  const indoorIds = new Set(['dust']);
  if (preferences.concern !== 'unknown') indoorIds.add(preferences.concern);
  if (profile.purifier) indoorIds.add('filter');
  const indoor = Object.fromEntries([...indoorIds].map((id) => [id, indoorActions[id].label]));

  const travel = {};
  if (preferences.rail || profile.travel === 'transit') travel.transit = travelOptions.transit.label;
  if (preferences.combine || profile.travel === 'bundle') travel.bundle = travelOptions.bundle.label;
  if (!Object.keys(travel).length) travel.none = travelOptions.none.label;
  return {
    audience: profile.audience, activity: flexibleActivity(profile), sensitive: profile.sensitive, fixedTime: profile.fixedTime,
    preferredTravel: profile.travel === 'none' ? null : profile.travel,
    usual: intervalSummary(plan.usual, profile.minutes), mode, priority: preferences.priority, indoorConcern: preferences.concern, schedule, indoor, travel,
  };
}

export function validRecommendation(value, context) {
  if (!isRecord(value) || Object.keys(value).length !== 4) return false;
  const { schedule, indoor, travel, rationale } = value;
  return [schedule, indoor, travel].every((id) => typeof id === 'string')
    && Object.hasOwn(context.schedule, schedule) && Object.hasOwn(context.indoor, indoor) && Object.hasOwn(context.travel, travel)
    && typeof rationale === 'string' && rationale.trim().length >= 20 && rationale.length <= 260
    && !/[\p{N}<>\r\n%]|https?:|\b(?:safe|safest|guaranteed|cures?|medication|diagnos\w*)\b/iu.test(rationale);
}
