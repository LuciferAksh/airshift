import { recommendationContext, validRecommendation } from './recommendations.mjs';

export function mountRecommendations(getInput, onUpdate) {
  const form = document.getElementById('recommend-form');
  const status = document.getElementById('recommend-status');
  const rationale = document.getElementById('recommend-rationale');
  const provenance = document.getElementById('recommend-provenance');
  const button = document.getElementById('recommend-submit');
  let controller;

  function reset() {
    controller?.abort();
    controller = null;
    button.removeAttribute('aria-disabled');
    rationale.hidden = true;
    rationale.textContent = '';
    status.textContent = '';
    provenance.textContent = 'Forecast-based starting plan';
  }

  form.addEventListener('input', () => { reset(); onUpdate(null); });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (controller) return;
    const conditions = getInput();
    if (!conditions) return;
    reset();
    onUpdate(null);
    const preferences = Object.fromEntries(new FormData(form));
    const input = { ...conditions, preferences: { priority: preferences.priority, concern: preferences.concern, rail: preferences.rail === 'on', combine: preferences.combine === 'on' } };
    const active = new AbortController();
    controller = active;
    button.setAttribute('aria-disabled', 'true');
    status.textContent = 'Gemini is comparing your options…';
    try {
      const response = await fetch('/api/recommendations', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input), signal: active.signal,
      });
      const data = await response.json();
      if (active.signal.aborted) return;
      if (!response.ok || !validRecommendation(data.recommendation, recommendationContext(input))) {
        status.textContent = data.error ?? 'Gemini could not personalize this plan. The forecast-based plan remains available.';
        return;
      }
      onUpdate(data.recommendation);
      provenance.textContent = 'Personalized by Gemini';
      rationale.textContent = data.recommendation.rationale;
      rationale.hidden = false;
      status.textContent = 'Personalized recommendations are ready.';
    } catch {
      if (!active.signal.aborted) status.textContent = 'Gemini could not personalize this plan. The forecast-based plan remains available.';
    } finally {
      if (controller === active) {
        controller = null;
        button.removeAttribute('aria-disabled');
      }
    }
  });
  return { reset };
}
