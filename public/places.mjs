const endpoint = 'https://geocoding-api.open-meteo.com/v1/search';

export async function findPlaces(name, { fetcher = fetch, signal } = {}) {
  const query = name.trim();
  if (query.length < 2 || query.length > 80) throw new RangeError('Enter a city or postal code (2–80 characters).');
  const params = new URLSearchParams({ name: query, count: '8', language: 'en', format: 'json' });
  const response = await fetcher(`${endpoint}?${params}`, { credentials: 'omit', signal });
  if (!response.ok) throw new Error('City search temporarily unavailable. Try again or detect your location.');
  const { results = [] } = await response.json();
  if (!Array.isArray(results)) return [];
  return results.slice(0, 8).flatMap((result) => {
    const { name, admin1, country, latitude, longitude } = result ?? {};
    if (typeof name !== 'string' || !name.trim() || !Number.isFinite(latitude) || Math.abs(latitude) > 90 || !Number.isFinite(longitude) || Math.abs(longitude) > 180) return [];
    const label = [...new Set([name, admin1, country].filter((part) => typeof part === 'string' && part.trim()))].join(', ');
    return [{ label, lat: latitude, lon: longitude }];
  });
}

export function mountCitySearch(onSelect) {
  const form = document.getElementById('city-search');
  const input = document.getElementById('place-name');
  const status = document.getElementById('place-status');
  const list = document.getElementById('place-results');
  let pending;

  function reset() {
    pending?.abort();
    list.replaceChildren();
    list.hidden = true;
    status.textContent = '';
  }

  input.addEventListener('input', reset);
  document.getElementById('detect').addEventListener('click', reset);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    reset();
    const controller = new AbortController();
    pending = controller;
    status.textContent = 'Searching cities…';
    try {
      const matches = await findPlaces(input.value, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]) });
      if (controller.signal.aborted) return;
      for (const place of matches) {
        const item = document.createElement('li');
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'secondary';
        button.textContent = place.label;
        button.addEventListener('click', () => {
          reset();
          input.value = '';
          onSelect(place);
        });
        item.append(button);
        list.append(item);
      }
      list.hidden = matches.length === 0;
      status.textContent = matches.length ? `${matches.length} results. Choose your city.` : 'No matches. Try a city name, postal code, or city and country.';
    } catch (error) {
      if (!controller.signal.aborted) status.textContent = error instanceof RangeError ? error.message : 'City search is unavailable. Try again or use location detection.';
    }
  });
}
