import assert from 'node:assert/strict';
import test from 'node:test';
import { defaults } from '../public/catalog.mjs';
import { makePlan, sampleForecast } from '../public/planner.mjs';
import { recommendationContext, validRecommendation, validRecommendationInput } from '../public/recommendations.mjs';
import { findPlaces } from '../public/places.mjs';
import { rankRecommendations } from '../server/gemini.mjs';

const day = sampleForecast('delhi');
const preferences = { priority: 'schedule', concern: 'cooking', rail: true, combine: false };
const input = { profile: defaults(), hours: day.hours, mode: day.mode, preferences };
const selection = { schedule: 'closer', indoor: 'cooking', travel: 'transit', rationale: 'The earlier slot is closer to your routine, and the cooking choice addresses your stated concern.' };

test('the schedule choice changes the plan and recomputes impact from the real interval', () => {
  const original = makePlan(input.profile, day);
  const personalized = makePlan(input.profile, day, selection);
  assert.equal(original.best.start, 840);
  assert.ok(personalized.best.start < original.best.start);
  assert.ok(personalized.comparison.after > original.comparison.after);
  assert.ok(personalized.comparison.after < personalized.comparison.before);
  assert.match(personalized.indoor.label, /frying/);
  assert.equal(personalized.carKmAvoided, 0);
});

test('options exclude equipment and transport the user did not confirm', () => {
  assert.ok(validRecommendationInput(input));
  const context = recommendationContext(input);
  assert.deepEqual(Object.keys(context.indoor), ['dust', 'cooking']);
  assert.deepEqual(Object.keys(context.travel), ['transit']);
  assert.ok(validRecommendation(selection, context));
  for (const change of [{ indoor: 'filter' }, { travel: 'bundle' }, { schedule: 'invented' }, { rationale: 'This is safe and guarantees a 50% reduction.' }]) {
    assert.equal(validRecommendation({ ...selection, ...change }, context), false);
  }
  assert.equal(validRecommendationInput({ ...input, hours: day.hours.slice(1) }), false);
  assert.equal(validRecommendationInput({ ...input, profile: null }), false);
  assert.equal(validRecommendationInput({ ...input, preferences: { ...preferences, rail: 'yes' } }), false);
});

test('severe forecasts permit indoor only for a confirmed venue and respect a deferral choice', () => {
  const community = { ...defaults('community'), indoorAvailable: true, purifier: true };
  const context = recommendationContext({ ...input, profile: community });
  assert.deepEqual(Object.keys(context.schedule), ['indoors', 'defer']);
  assert.ok(Object.hasOwn(context.indoor, 'filter'));
  assert.equal(makePlan(community, day, { schedule: 'defer' }).decision, 'defer');
  assert.deepEqual(Object.keys(recommendationContext({ ...input, profile: defaults('community') }).schedule), ['defer']);
});

test('Gemini receives the feasible options and cannot inject a different travel option', async () => {
  const context = recommendationContext(input);
  const reply = (choice) => async (_, request) => {
    const body = JSON.parse(request.body);
    assert.deepEqual(body.generationConfig.responseJsonSchema.properties.travel.enum, ['transit']);
    assert.equal(JSON.parse(body.contents[0].parts[0].text).fixedTime, '15:00');
    return Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(choice) }] } }] });
  };
  assert.deepEqual(await rankRecommendations(context, { key: 'fake', fetcher: reply(selection) }), selection);
  await assert.rejects(rankRecommendations(context, { key: 'fake', fetcher: reply({ ...selection, travel: 'bundle' }) }), /validation/);
});

test('city and postal lookup preserve disambiguation and reject malformed places', async () => {
  const fetcher = async (url, options) => {
    assert.equal(new URL(url).searchParams.get('name'), 'Pune, India');
    assert.equal(options.credentials, 'omit');
    return Response.json({ results: [{ name: 'Pune', admin1: 'Maharashtra', country: 'India', latitude: 18.52, longitude: 73.86 }, null, { name: 'Invalid', latitude: 99, longitude: 0 }] });
  };
  assert.deepEqual(await findPlaces(' Pune, India ', { fetcher }), [{ label: 'Pune, Maharashtra, India', lat: 18.52, lon: 73.86 }]);
  await assert.rejects(findPlaces('p', { fetcher }), /2–80/);
});
