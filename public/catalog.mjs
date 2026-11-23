export const cities = Object.freeze({
  delhi: { name: 'New Delhi', lat: 28.61, lon: 77.21 },
  noida: { name: 'Noida', lat: 28.57, lon: 77.32 },
  lucknow: { name: 'Lucknow', lat: 26.85, lon: 80.95 },
  patna: { name: 'Patna', lat: 25.59, lon: 85.14 },
});

export const sources = Object.freeze({
  forecast: 'https://open-meteo.com/en/docs/air-quality-api',
  cams: 'https://atmosphere.copernicus.eu/',
  cpcb: 'https://app.cpcbccr.com/AQIIndia',
  activity: 'https://www.airnow.gov/publications/activity-guides/air-quality-and-outdoor-activity-guidance-for-schools/',
  indoor: 'https://www.epa.gov/indoor-air-quality-iaq/sources-indoor-particulate-matter-pm',
  cleanerRoom: 'https://www.epa.gov/emergencies-iaq/create-clean-room-protect-indoor-air-quality-during-wildfire',
});

export const audiences = Object.freeze({
  family: { label: 'Household', fixed: 'School pickup', flexible: 'Market errand' },
  community: { label: 'Community', fixed: 'Essential supply pickup', flexible: 'Outdoor group activity' },
});

export const activities = Object.freeze({
  default: { label: 'Use the suggested activity', strenuous: false },
  errand: { label: 'Market errand', strenuous: false },
  exercise: { label: 'Outdoor exercise', strenuous: true },
  play: { label: 'Outdoor play', strenuous: true },
  group: { label: 'Outdoor group activity', strenuous: true },
});

/** @param {import('../types/airshift.js').Profile} profile */
export function flexibleActivity(profile) {
  return profile.activity === 'default' ? audiences[profile.audience].flexible : activities[profile.activity].label;
}

export const travelOptions = Object.freeze({
  none: { label: 'Keep my usual travel', effect: 'Travel stays as entered.' },
  transit: { label: 'Replace the solo drive with a train or metro', effect: 'This removes the entered solo car distance from your plan. Check transfers and outdoor walking separately.' },
  bundle: { label: 'Combine two stops in one drive', effect: 'This avoids the entered detour distance if the two stops would otherwise need separate drives.' },
});

export const indoorActions = Object.freeze({
  smoke: {
    label: 'Skip incense and candles today',
    effect: 'Burning incense and candles creates particles indoors. Skipping them removes that source.',
    source: sources.indoor,
  },
  cooking: {
    label: 'Choose a meal that needs less frying',
    effect: 'Frying can release particles indoors. Choose a lower-smoke cooking method and use required kitchen ventilation.',
    source: sources.cleanerRoom,
  },
  filter: {
    label: 'Run your portable particle filter where people gather',
    effect: 'A properly sized particle filter can lower airborne particles in that room. Follow the unit’s operating instructions.',
    source: sources.indoor,
  },
  dust: {
    label: 'Damp-wipe dusty surfaces in the room you use most',
    effect: 'A damp cloth picks up settled dust so less of it is stirred back into the air. The effect depends on how much dust is present.',
    source: sources.cleanerRoom,
  },
});

/**
 * @param {import('../types/airshift.js').Audience} [audience]
 * @returns {import('../types/airshift.js').Profile}
 */
export function defaults(audience = 'family') {
  return {
    audience, activity: 'default', fixedTime: '15:00', fixedMinutes: 15, usualTime: '09:00',
    earliest: '09:00', latest: '17:00', minutes: 30, sensitive: true,
    indoorAvailable: false, purifier: false, indoorAction: 'smoke', travel: 'none', distance: 0,
  };
}
