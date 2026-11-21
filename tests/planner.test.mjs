import assert from 'node:assert/strict';
import test from 'node:test';
import { defaults } from '../public/catalog.mjs';
import { activityNotice, aqiBand, formatTime, makePlan, sampleForecast, validDraft, validateProfile } from '../public/planner.mjs';

const uniformForecast = (pm, aqi) => ({ ...sampleForecast('delhi'), hours: Array.from({ length: 24 }, (_, time) => ({ time, pm, aqi })) });

test('Delhi sample keeps pickup and compare like-for-like time outdoors', () => {
  const profile = defaults();
  const plan = makePlan(profile, sampleForecast('delhi'));
  assert.equal(plan.decision, 'shift');
  assert.equal(formatTime(plan.fixed.start), '15:00');
  assert.equal(formatTime(plan.best.start), '14:00');
  assert.equal(plan.comparison.before, 99);
  assert.equal(plan.comparison.after, 36);
  assert.equal(Math.round(plan.comparison.change), 64);
});

test('same conditions favor the usual time if that slot is feasible', () => {
  const plan = makePlan({ ...defaults(), usualTime: '12:38' }, uniformForecast(33, 60));
  assert.equal(plan.decision, 'keep');
  assert.equal(formatTime(plan.best.start), '12:38');
});

test('partial hour weighting accounts for the incoming hour and exact endpoints', () => {
  const forecast = uniformForecast(100, 70);
  forecast.hours[11].pm = 40;
  forecast.hours[12].pm = 160;
  const plan = makePlan({ ...defaults(), usualTime: '11:45', earliest: '11:00', latest: '11:30' }, forecast);
  assert.equal(plan.comparison.before, 50);
  assert.equal(plan.comparison.after, 20);
});

test('checks peak AQI across the full interval and preserves the fixed appointment', () => {
  const forecast = uniformForecast(20, 85);
  forecast.hours[12].aqi = 310;
  const plan = makePlan({ ...defaults(), earliest: '11:45', latest: '13:45', fixedTime: '13:00', fixedMinutes: 15 }, forecast);
  assert.equal(formatTime(plan.best.start), '13:15');
  assert.equal(plan.best.peak, 85);
});

test('all-day hazard defers flexible errands and never alters fixed slots', () => {
  const plan = makePlan(defaults(), uniformForecast(300, 345));
  assert.equal(plan.decision, 'defer');
  assert.equal(plan.fixed.start, 900);
  assert.equal(plan.outdoorMinutesAvoided, 30);
  assert.equal(plan.comparison, null);
});

test('outdoor exercise uses cautious activity limits and a confirmed indoor fallback', () => {
  const day = sampleForecast('delhi');
  const profile = { ...defaults(), activity: 'exercise', indoorAvailable: true };
  assert.equal(makePlan(profile, day).decision, 'indoors');
  assert.equal(makePlan({ ...profile, indoorAvailable: false }, day).decision, 'defer');
  assert.equal(makePlan({ ...profile, activity: 'errand' }, day).decision, 'shift');
});

test('community requires a confirmed indoor option and labels sample notes', () => {
  const day = sampleForecast('delhi');
  assert.equal(makePlan(defaults('community'), day).decision, 'defer');
  const profile = { ...defaults('community'), indoorAvailable: true };
  const plan = makePlan(profile, day);
  assert.equal(plan.decision, 'indoors');
  const notice = activityNotice(profile, day, plan);
  assert.match(notice, /demonstration only/);
  assert.match(notice, /confirmed indoor option/);
  assert.doesNotMatch(notice, /15:00/);
});

test('positive, negative and zero-baseline comparisons never fabricate reductions', () => {
  const profile = { ...defaults(), usualTime: '08:00', earliest: '14:00', latest: '14:30', travel: 'bundle', distance: 4.8 };
  const day = uniformForecast(20, 70);
  day.hours[8].pm = 10;
  const plan = makePlan(profile, day);
  assert.equal(plan.comparison.change, -100);
  assert.equal(plan.carKmAvoided, 4.8);
  day.hours[8].pm = 0;
  assert.equal(makePlan(profile, day).comparison.change, null);
  assert.equal(makePlan({ ...profile, travel: 'none' }, day).carKmAvoided, 0);
});

test('profiles reject unfit windows, cross-midnight activities and unavailable filters', () => {
  assert.match(validateProfile({ ...defaults(), earliest: '16:45' }), /latest finish/);
  assert.match(validateProfile({ ...defaults(), fixedTime: '23:55' }), /same day/);
  assert.match(validateProfile({ ...defaults(), indoorAction: 'filter' }), /portable filter/);
  assert.equal(validateProfile({ ...defaults(), indoorAction: 'filter', purifier: true }), '');
});

test('Gemini draft accepts only supported scalars and preserves explicit false', () => {
  assert.equal(validDraft({ indoorAvailable: false, fixedTime: '08:00', minutes: 15, distance: 2.4 }), true);
  for (const input of [{ advice: 'unsafe' }, { fixedTime: '24:00' }, { minutes: 5.1 }, { distance: Infinity }, { travel: 'bike' }, { sensitive: 'false' }, []]) {
    assert.equal(validDraft(input), false);
  }
});

test('AQI bands handle each upper boundary and forecast gaps fail closed', () => {
  for (const [value, tone] of [[50, 'good'], [51, 'moderate'], [100, 'moderate'], [101, 'sensitive'], [150, 'sensitive'], [151, 'high'], [200, 'high'], [201, 'very'], [300, 'very'], [301, 'hazard']]) {
    assert.equal(aqiBand(value).tone, tone);
  }
  const day = sampleForecast('delhi');
  delete day.hours[15];
  assert.throws(() => makePlan(defaults(), day), /incomplete/);
});
