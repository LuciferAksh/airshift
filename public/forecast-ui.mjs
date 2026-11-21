import { cities } from './catalog.mjs';
import { aqiBand, formatTime, sampleForecast } from './planner.mjs';
import { drawChart } from './chart.mjs';
import { fetchAirData, forecastLocation } from './air-data.mjs';
import { mountCitySearch } from './places.mjs';
import { byId, number, responseError, setText } from './dom.mjs';

const DEFAULT_CITY = 'delhi';
const displayZone = (zone) => ['Asia/Kolkata', 'Asia/Calcutta'].includes(zone) ? 'IST' : zone;

function renderCurrent(forecast, message = '') {
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

function renderForecast(forecast, chart) {
  const loaded = Boolean(forecast);
  chart.hidden = !loaded;
  chart.nextElementSibling.hidden = !loaded;
  const detail = byId('hours').closest('details');
  detail.hidden = !loaded;
  setText('hourly-caption', `Regional outdoor air quality · ${displayZone(forecast?.timezone ?? 'IST')}`);
  const rows = (forecast?.hours ?? []).map(({ time, pm, aqi }) => {
    const tr = document.createElement('tr');
    const timeHeader = document.createElement('th');
    timeHeader.scope = 'row';
    timeHeader.textContent = formatTime(time * 60);
    tr.append(timeHeader);
    for (const value of [number(pm), number(aqi)]) {
      const td = document.createElement('td');
      td.textContent = value;
      tr.append(td);
    }
    return tr;
  });
  byId('hours').replaceChildren(...rows);
}

async function requestForecast(location, signal) {
  const useBrowser = document.documentElement.dataset.forecastTransport === 'browser';
  const fromProvider = () => fetchAirData(forecastLocation(location ?? DEFAULT_CITY), { signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]) });
  if (useBrowser) {
    try { return await fromProvider(); }
    catch { signal.throwIfAborted(); }
  }
  const request = location ? {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lat: location.lat, lon: location.lon }),
  } : {};
  const url = location ? '/api/location' : `/api/forecast?city=${DEFAULT_CITY}`;
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

export function mountForecast(onChange) {
  const mode = byId('mode');
  const detect = byId('detect');
  const chart = byId('chart');
  let forecast = null;
  let forecastRequest;
  let livePlace;
  let detection = 0;
  let suggestedHour = null;

  function draw() {
    if (forecast) drawChart(chart, forecast, suggestedHour);
  }

  function publish(value, currentMessage) {
    forecast = value;
    renderCurrent(forecast, currentMessage);
    renderForecast(forecast, chart);
    onChange(forecast);
  }

  async function loadForecast() {
    forecastRequest?.abort();
    if (mode.value === 'sample') {
      setText('active-location', `${cities[DEFAULT_CITY].name} · sample`);
      setText('forecast-label', 'Sample day');
      setText('dataset', 'Sample · simulated');
      setText('forecast-status', `${cities[DEFAULT_CITY].name} · Example winter conditions in IST`);
      byId('official-aqi').hidden = false;
      publish(sampleForecast(DEFAULT_CITY));
      return;
    }

    const controller = new AbortController();
    forecastRequest = controller;
    const location = livePlace;
    const label = location?.label ?? (location ? 'Your location' : cities[DEFAULT_CITY].name);
    const locationName = location && !location.label ? 'your location' : label;
    setText('active-location', label);
    setText('forecast-label', 'Tomorrow');
    setText('dataset', 'Model forecast');
    setText('forecast-status', `Loading forecast for ${locationName}…`);
    byId('official-aqi').hidden = Boolean(location);
    publish(null, `Loading current conditions for ${locationName}…`);
    try {
      const data = await requestForecast(location, controller.signal);
      if (controller.signal.aborted) return;
      const localized = location?.label ? { ...data, cityLabel: label } : data;
      const timezone = displayZone(data.timezone);
      const pulled = new Intl.DateTimeFormat('en-IN', { timeZone: data.timezone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(data.fetchedAt));
      setText('forecast-status', `${label} · ${data.date} ${timezone} · Retrieved ${pulled} local time`);
      byId('official-aqi').hidden = timezone !== 'IST';
      publish(localized);
    } catch (error) {
      if (controller.signal.aborted) return;
      setText('forecast-status', responseError(error, 'Forecast unavailable. Switch to the labeled sample to explore.'));
      publish(null);
    }
  }

  function detectLocation() {
    const status = 'location-status';
    if (detect.getAttribute('aria-disabled') === 'true') return;
    if (!window.isSecureContext || !navigator.geolocation) {
      setText(status, 'Location detection needs a secure browser connection. You can search for a city.');
      return;
    }
    const attempt = ++detection;
    detect.setAttribute('aria-disabled', 'true');
    setText(status, 'Waiting for location permission…');
    navigator.geolocation.getCurrentPosition(({ coords }) => {
      if (attempt !== detection) return;
      livePlace = { lat: Number(coords.latitude.toFixed(1)), lon: Number(coords.longitude.toFixed(1)) };
      mode.value = 'forecast';
      detect.removeAttribute('aria-disabled');
      setText(status, 'Using the regional forecast for your approximate location.');
      loadForecast();
    }, (error) => {
      if (attempt !== detection) return;
      detect.removeAttribute('aria-disabled');
      setText(status, error.code === 1 ? 'Location permission was declined. Search for a city or allow access to try again.' : 'Your location could not be found. Search for a city or try again.');
    }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 });
  }

  function changeForecastSettings() {
    detection += 1;
    detect.removeAttribute('aria-disabled');
    setText('location-status', '');
    loadForecast();
  }

  mountCitySearch((place) => {
    livePlace = place;
    mode.value = 'forecast';
    changeForecastSettings();
    byId('forecast-location').focus();
  });
  mode.addEventListener('change', changeForecastSettings);
  detect.addEventListener('click', detectLocation);
  new ResizeObserver(draw).observe(chart);

  return {
    start() {
      if (new URLSearchParams(window.location.search).get('sample') === '1') mode.value = 'sample';
      loadForecast();
    },
    highlight(hour) {
      suggestedHour = hour;
      draw();
    },
  };
}
