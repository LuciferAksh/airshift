import { activities, audiences, cities, defaults, flexibleActivity, indoorActions, travelOptions } from './catalog.mjs';
import { activityNotice, aqiBand, formatTime, makePlan, sampleForecast, validDraft, validateProfile } from './planner.mjs';
import { drawChart } from './chart.mjs';
import { fetchAirData, forecastLocation } from './air-data.mjs';
import { mountCitySearch } from './places.mjs';
import { mountRecommendations } from './recommendations-ui.mjs';

const byId = (id) => document.getElementById(id);
const setText = (id, text) => { byId(id).textContent = text; };
const number = (value) => value.toLocaleString('en-IN', { maximumFractionDigits: 1 });
const displayZone = (zone) => ['Asia/Kolkata', 'Asia/Calcutta'].includes(zone) ? 'IST' : zone;
const form = byId('routine-form');
const chart = byId('chart');
const initial = defaults();
const defaultCity = 'delhi';
let profile = initial;
let forecast = null;
let forecastRequest;
let livePlace = null;
let detection = 0;
let draft = null;
let suggestedHour = null;
let recommendation = null;

const recommendationUI = mountRecommendations(
  () => forecast && { profile, hours: forecast.hours, mode: forecast.mode },
  (selection) => { recommendation = selection; renderPlan(); },
);

function clearRecommendation() {
  recommendation = null;
  recommendationUI.reset();
}

function writeForm(settings) {
  for (const [name, value] of Object.entries(settings)) {
    const input = form.elements.namedItem(name);
    if (input.type === 'checkbox') input.checked = value;
    else input.value = value;
  }
  const audience = form.elements.namedItem('audience').value;
  setText('fixed-label', audiences[audience].fixed);
}

function readForm() {
  const settings = {};
  for (const [name, value] of Object.entries(initial)) {
    const input = form.elements.namedItem(name);
    settings[name] = typeof value === 'boolean' ? input.checked : input.value;
    if (typeof value === 'number') settings[name] = input.valueAsNumber;
  }
  return settings;
}

function renderChart() {
  drawChart(chart, forecast, suggestedHour);
}

function renderCurrent(message = '') {
  const info = forecast?.current;
  byId('current-grid').hidden = !info;
  setText('current-meta', message || 'Current conditions are unavailable for this location.');
  if (!info) return;
  const sample = forecast.mode === 'sample';
  const provenance = sample ? 'Simulated sample' : 'Open-Meteo / CAMS model estimate';
  const time = info.time.replace('T', ' at ');
  setText('current-meta', `${provenance} · ${time} ${displayZone(forecast.timezone)}`);
  const band = aqiBand(info.aqi);
  byId('current-index').dataset.tone = band.tone;
  setText('current-aqi', number(info.aqi));
  setText('current-band', band.label);
  setText('current-pm', info.pm === null ? 'Unavailable' : number(info.pm));
  setText('current-pm10', info.pm10 === null ? 'Unavailable' : number(info.pm10));
  setText('current-top', info.top ?? 'Unavailable');
}

function renderForecast() {
  const loaded = Boolean(forecast);
  chart.hidden = !loaded;
  chart.nextElementSibling.hidden = !loaded;
  const detail = byId('hours').closest('details');
  detail.hidden = !loaded;
  setText('hourly-caption', `Regional outdoor air quality · ${displayZone(forecast?.timezone ?? 'IST')}`);
  const rows = (forecast?.hours ?? []).map(({ time, pm, aqi }) => {
    const tr = document.createElement('tr');
    for (const value of [formatTime(time * 60), number(pm), number(aqi)]) {
      const td = document.createElement('td');
      td.textContent = value;
      tr.append(td);
    }
    return tr;
  });
  byId('hours').replaceChildren(...rows);
}

function renderFlexible(plan) {
  const label = flexibleActivity(profile).toLowerCase();
  if (!plan.best) {
    setText('flex-title', plan.decision === 'indoors' ? `Move ${label} indoors` : `Postpone ${label}`);
    const indoor = plan.decision === 'indoors' ? ' Use the available indoor space if its air conditions and local guidance allow.' : ' Check again when the forecast improves.';
    setText('flex-reason', `No available interval fits the planner’s US AQI limit of ${plan.maxAqi} for this activity.${indoor}`);
    setText('exposure-number', `${plan.outdoorMinutesAvoided} min moved off the outdoor plan`);
    setText('exposure-note', 'Counts the planned outdoor minutes removed today. Indoor exposure is unknown.');
    return;
  }
  const proposed = formatTime(plan.best.start);
  const end = formatTime(plan.best.start + profile.minutes);
  setText('flex-title', plan.decision === 'keep' ? `Keep ${label} at ${proposed}` : `Move ${label} to ${proposed}`);
  const band = aqiBand(plan.best.peak).label.toLowerCase();
  const guidance = plan.best.peak > 150 ? ' Keep essential outings brief and consider postponing optional ones.' : '';
  const reason = recommendation?.schedule === 'closer'
    ? 'stays closer to your usual time and meets your outdoor limit' : 'has the lowest forecast particle exposure within your eligible window';
  setText('flex-reason', `${proposed}–${end} ${reason}. Peak US AQI ${Math.round(plan.best.peak)} (${band}).${guidance}`);
  const { before, after, change } = plan.comparison;
  const result = change === null ? 'See comparison' : Math.abs(change) < .5 ? 'About the same' : `${Math.round(Math.abs(change))}% ${change > 0 ? 'lower' : 'higher'}`;
  setText('exposure-number', result);
  setText('exposure-note', `${number(before)} → ${number(after)} µg·h/m³ for the flexible activity. Forecast concentration × planned outdoor time.`);
}

function renderPlan() {
  byId('result-content').hidden = !forecast;
  byId('result-empty').hidden = Boolean(forecast);
  setText('audience-pill', audiences[profile.audience].label);
  suggestedHour = null;
  if (!forecast) return;

  const plan = makePlan(profile, forecast, recommendation);
  const labels = audiences[profile.audience];
  suggestedHour = plan.best ? Math.floor(plan.best.start / 60) : null;
  setText('fixed-title', `${labels.fixed} stays at ${profile.fixedTime}`);
  const peak = Math.round(plan.fixed.peak);
  const band = aqiBand(plan.fixed.peak).label.toLowerCase();
  const guidance = plan.fixed.peak > 100 ? ' Keep the outdoor wait as short as practical and follow local advisories.' : ' Recheck conditions before leaving.';
  setText('fixed-reason', `Peak forecast US AQI ${peak} (${band}) during the fixed slot.${guidance}`);
  renderFlexible(plan);
  setText('indoor-title', plan.indoor.label);
  setText('indoor-reason', plan.indoor.effect);
  byId('indoor-source').href = plan.indoor.source;

  const travelId = recommendation?.travel ?? profile.travel;
  const travel = travelOptions[travelId];
  const enteredDistance = travelId !== 'none' && travelId === profile.travel && profile.distance > 0;
  byId('travel-row').hidden = !recommendation && travelId === 'none';
  setText('travel-title', travel.label);
  setText('travel-reason', travelId === 'none' ? 'Confirm an available rail trip or stops you can combine to compare an alternative.' : travel.effect);
  setText('travel-number', travelId === 'none' ? '0 km' : enteredDistance ? `${number(plan.carKmAvoided)} km` : 'Distance needed');
  setText('travel-note', enteredDistance ? 'Based on the solo drive or detour distance you entered.' : 'Choose the suggested travel change and enter your avoidable distance in the routine settings.');
  byId('share').hidden = profile.audience !== 'community';
  byId('notice-text').value = activityNotice(profile, forecast, plan);
  setText('copy-status', '');
  renderChart();
}

async function loadForecast() {
  forecastRequest?.abort();
  clearRecommendation();
  if (byId('mode').value === 'sample') {
    forecast = sampleForecast(defaultCity);
    setText('active-location', `${cities[defaultCity].name} · sample`);
    setText('forecast-label', 'Sample day');
    setText('dataset', 'Sample · simulated');
    setText('forecast-status', `${cities[defaultCity].name} · Example winter conditions in IST`);
    byId('official-aqi').hidden = false;
    renderCurrent();
    renderForecast();
    renderPlan();
    return;
  }

  const controller = new AbortController();
  forecastRequest = controller;
  const location = livePlace;
  const label = location?.label ?? (location ? 'Your location' : cities[defaultCity].name);
  const locationName = location && !location.label ? 'your location' : label;
  setText('active-location', label);
  forecast = null;
  setText('forecast-label', 'Tomorrow');
  setText('dataset', 'Model forecast');
  setText('forecast-status', `Loading forecast for ${locationName}…`);
  byId('official-aqi').hidden = Boolean(location);
  renderCurrent(`Loading current conditions for ${locationName}…`);
  renderForecast();
  renderPlan();
  try {
    const data = await requestForecast(location, controller.signal);
    if (controller.signal.aborted) return;
    forecast = location?.label ? { ...data, cityLabel: label } : data;
    const timezone = displayZone(data.timezone);
    const pulled = new Intl.DateTimeFormat('en-IN', { timeZone: data.timezone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(data.fetchedAt));
    setText('forecast-status', `${label} · ${data.date} ${timezone} · Retrieved ${pulled} local time`);
    byId('official-aqi').hidden = timezone !== 'IST';
    renderCurrent();
    renderForecast();
    renderPlan();
  } catch (error) {
    if (controller.signal.aborted) return;
    forecast = null;
    setText('forecast-status', responseError(error, 'Forecast unavailable. Switch to the labeled sample to explore.'));
    renderCurrent();
    renderForecast();
    renderPlan();
  }
}

async function requestForecast(location, signal) {
  const useBrowser = document.documentElement.dataset.forecastTransport === 'browser';
  const fromProvider = () => fetchAirData(forecastLocation(location ?? defaultCity), { signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]) });
  if (useBrowser) {
    try { return await fromProvider(); }
    catch { signal.throwIfAborted(); }
  }
  const request = location ? {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lat: location.lat, lon: location.lon }),
  } : {};
  const url = location ? '/api/location' : `/api/forecast?city=${defaultCity}`;
  const response = await fetch(url, { ...request, signal }).catch(() => null);
  if (response?.ok) return response.json();
  signal.throwIfAborted();
  if (response && response.status < 500) throw new Error((await response.json()).error);
  if (!useBrowser) {
    try { return await fromProvider(); }
    catch { signal.throwIfAborted(); }
  }
  throw new Error('Forecast unavailable. Try another location or switch to the labeled sample.');
}

function detectLocation() {
  const status = 'location-status';
  const button = byId('detect');
  if (!window.isSecureContext || !navigator.geolocation) {
    setText(status, 'Location detection needs a secure browser connection. You can search for a city.');
    return;
  }
  const attempt = ++detection;
  button.disabled = true;
  setText(status, 'Waiting for location permission…');
  navigator.geolocation.getCurrentPosition(({ coords }) => {
    if (attempt !== detection) return;
    livePlace = { lat: Number(coords.latitude.toFixed(1)), lon: Number(coords.longitude.toFixed(1)) };
    byId('mode').value = 'forecast';
    button.disabled = false;
    setText(status, 'Using the regional forecast for your approximate location.');
    loadForecast();
  }, (error) => {
    if (attempt !== detection) return;
    button.disabled = false;
    setText(status, error.code === 1 ? 'Location permission was declined. Search for a city or allow access to try again.' : 'Your location could not be found. Search for a city or try again.');
  }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 });
}

function changeForecastSettings() {
  detection += 1;
  byId('detect').disabled = false;
  setText('location-status', '');
  loadForecast();
}

function responseError(error, fallback) {
  return error instanceof Error && error.message && error.name === 'Error' ? error.message : fallback;
}

function commit(settings) {
  const error = validateProfile(settings);
  setText('plan-status', error || 'Plan updated.');
  if (error) return false;
  profile = settings;
  clearRecommendation();
  renderPlan();
  return true;
}

const draftLabels = {
  activity: 'Flexible activity', fixedTime: 'Fixed start', fixedMinutes: 'Fixed outdoor minutes', usualTime: 'Usual start', earliest: 'Earliest start',
  latest: 'Latest finish', minutes: 'Flexible outdoor minutes', sensitive: 'Cautious planning', indoorAvailable: 'Indoor group venue',
  purifier: 'Portable filter', indoorAction: 'Indoor action', travel: 'Travel change', distance: 'Solo car kilometres avoided',
};

function showDraft(value) {
  draft = value;
  byId('draft-review').hidden = !draft;
  const items = Object.entries(draft ?? {}).map(([name, setting]) => {
    const item = document.createElement('li');
    let text = typeof setting === 'boolean' ? (setting ? 'Yes' : 'No') : setting;
    if (name === 'travel') text = travelOptions[setting].label;
    if (name === 'indoorAction') text = indoorActions[setting].label;
    if (name === 'activity') text = activities[setting].label;
    item.textContent = `${draftLabels[name]} — ${text}`;
    return item;
  });
  byId('draft-list').replaceChildren(...items);
}

async function askGemini(event) {
  event.preventDefault();
  const button = byId('ask');
  const note = byId('note').value;
  if (button.disabled) return;
  button.disabled = true;
  showDraft(null);
  setText('ai-status', 'Reading your routine…');
  try {
    const response = await fetch('/api/routine', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ note }),
    });
    const body = await response.json();
    if (note !== byId('note').value) {
      setText('ai-status', 'The note changed. Draft settings again when you’re ready.');
      return;
    }
    if (!response.ok) throw new Error(body.error);
    if (!validDraft(body.draft) || !Object.keys(body.draft).length) {
      setText('ai-status', 'No supported settings found. Add a specific time, duration or travel change.');
      return;
    }
    showDraft(body.draft);
    setText('ai-status', 'Check the proposed settings before applying them.');
  } catch (error) {
    setText('ai-status', responseError(error, 'Gemini is unavailable. You can still update the plan directly.'));
  } finally {
    button.disabled = false;
  }
}

mountCitySearch((place) => {
  livePlace = place;
  byId('mode').value = 'forecast';
  changeForecastSettings();
  byId('forecast-location').focus();
});
byId('mode').addEventListener('change', changeForecastSettings);
byId('detect').addEventListener('click', detectLocation);
byId('audience').addEventListener('change', () => writeForm({}));
form.addEventListener('submit', (event) => { event.preventDefault(); commit(readForm()); });
byId('ai-form').addEventListener('submit', askGemini);
byId('note').addEventListener('input', () => {
  if (!draft) return;
  showDraft(null);
  setText('ai-status', 'The note changed. Draft settings again when you’re ready.');
});
byId('example-note').addEventListener('click', () => {
  const note = byId('note');
  if (note.value.trim()) {
    note.focus();
    setText('ai-status', 'Clear the current note to load the example.');
    return;
  }
  note.value = 'Pickup is at 4 pm. My 30-minute market errand usually starts at 9 am, but I am free from 11 am to 5 pm. I can replace a 6 km solo drive with the metro.';
  note.focus();
});
byId('apply').addEventListener('click', () => {
  if (!draft) return;
  const settings = { ...readForm(), ...draft };
  const error = validateProfile(settings);
  if (error) { setText('ai-status', error); return; }
  writeForm(settings);
  commit(settings);
  byId('ask').focus();
  showDraft(null);
  setText('ai-status', 'Reviewed settings applied to the day plan.');
});
byId('copy').addEventListener('click', async () => {
  const notice = byId('notice-text');
  try {
    await navigator.clipboard.writeText(notice.value);
    setText('copy-status', 'Notice copied.');
  } catch {
    notice.focus();
    notice.select();
    setText('copy-status', 'Press Ctrl+C or use your device’s Copy command.');
  }
});
new ResizeObserver(renderChart).observe(chart);
writeForm(profile);
if (new URLSearchParams(window.location.search).get('sample') === '1') byId('mode').value = 'sample';
loadForecast();
