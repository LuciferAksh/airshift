import { flexibleActivity, indoorActions, travelOptions } from './catalog.mjs';
import { formatTime, isProfile, makePlan } from './planner.mjs';
import { hasKey, isRecord } from './validation.mjs';

const priorities = { exposure: true, schedule: true, travel: true };
const concerns = { unknown: true, smoke: true, cooking: true, dust: true };

/** @param {unknown} value @returns {value is import('../types/airshift.js').RecommendationInput} */
export function validRecommendationInput(value) {
  if (!isRecord(value) || Object.keys(value).length !== 4) return false;
  const { profile, preferences, hours, mode } = value;
  if (!isProfile(profile) || !isRecord(preferences) || Object.keys(preferences).length !== 4) return false;
  if (!hasKey(priorities, preferences.priority) || !hasKey(concerns, preferences.concern)
    || typeof preferences.rail !== 'boolean' || typeof preferences.combine !== 'boolean') return false;
  return (mode === 'sample' || mode === 'forecast') && Array.isArray(hours) && hours.length === 24 && Array.from(hours).every((point, time) => (
    isRecord(point) && Object.keys(point).length === 3 && point.time === time
    && typeof point.pm === 'number' && Number.isFinite(point.pm) && point.pm >= 0 && point.pm <= 10000
    && typeof point.aqi === 'number' && Number.isFinite(point.aqi) && point.aqi >= 0 && point.aqi <= 2000
  ));
}

/** @param {import('../types/airshift.js').Interval} interval @param {number} duration */
function intervalSummary(interval, duration) {
  return { start: formatTime(interval.start), end: formatTime(interval.start + duration), peakUsAqi: Math.round(interval.peak), outdoorParticleIndex: Number(interval.area.toFixed(2)) };
}

/** @param {import('../types/airshift.js').RecommendationInput} input @returns {import('../types/airshift.js').RecommendationContext} */
export function recommendationContext({ profile, preferences, hours, mode }) {
  const plan = makePlan(profile, { hours });
  /** @type {import('../types/airshift.js').RecommendationContext['schedule']} */
  const schedule = {};
  if (plan.lowest) schedule.lowest = intervalSummary(plan.lowest, profile.minutes);
  if (plan.closer) schedule.closer = intervalSummary(plan.closer, profile.minutes);
  if (!plan.lowest && plan.decision === 'indoors') schedule.indoors = 'Use the confirmed indoor alternative';
  if (!plan.lowest) schedule.defer = 'Postpone the optional outdoor activity';

  /** @type {Set<import('../types/airshift.js').IndoorAction>} */
  const indoorIds = new Set(['dust']);
  if (preferences.concern !== 'unknown') indoorIds.add(preferences.concern);
  if (profile.purifier) indoorIds.add('filter');
  const indoor = Object.fromEntries([...indoorIds].map((id) => [id, indoorActions[id].label]));

  /** @type {import('../types/airshift.js').RecommendationContext['travel']} */
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

/** @param {unknown} value @param {import('../types/airshift.js').RecommendationContext} context @returns {value is import('../types/airshift.js').Recommendation} */
export function validRecommendation(value, context) {
  if (!isRecord(value) || Object.keys(value).length !== 4) return false;
  const { schedule, indoor, travel, rationale } = value;
  return hasKey(context.schedule, schedule) && hasKey(context.indoor, indoor) && hasKey(context.travel, travel)
    && typeof rationale === 'string' && rationale.trim().length >= 20 && rationale.length <= 260
    && !/[\p{N}<>\r\n%]|https?:|\b(?:safe|safest|guaranteed|cures?|medication|diagnos\w*)\b/iu.test(rationale);
}
