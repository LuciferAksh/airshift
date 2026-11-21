import { activities, audiences, indoorActions, travelOptions } from './catalog.mjs';
import { byId, responseError, setText } from './dom.mjs';
import { profileIssue, validDraft } from './planner.mjs';

const draftLabels = {
  activity: 'Flexible activity',
  fixedTime: 'Fixed start',
  fixedMinutes: 'Fixed outdoor minutes',
  usualTime: 'Usual start',
  earliest: 'Earliest start',
  latest: 'Latest finish',
  minutes: 'Flexible outdoor minutes',
  sensitive: 'Cautious planning',
  indoorAvailable: 'Indoor group venue',
  purifier: 'Portable filter',
  indoorAction: 'Indoor action',
  travel: 'Travel change',
  distance: 'Solo car kilometres avoided',
};

const choices = { activity: activities, indoorAction: indoorActions, travel: travelOptions };

export function mountRoutine(initial, onApply) {
  const form = byId('routine-form');
  const formStatus = byId('plan-status');
  let invalidField;

  function updateFixedLabel() {
    const audience = form.elements.namedItem('audience').value;
    setText('fixed-label', audiences[audience].fixed);
  }

  function writeForm(settings) {
    for (const [name, value] of Object.entries(settings)) {
      const input = form.elements.namedItem(name);
      if (input.type === 'checkbox') input.checked = value;
      else input.value = value;
    }
    updateFixedLabel();
  }

  function readForm() {
    const settings = {};
    for (const [name, value] of Object.entries(initial)) {
      const input = form.elements.namedItem(name);
      if (typeof value === 'boolean') settings[name] = input.checked;
      else if (typeof value === 'number') settings[name] = input.valueAsNumber;
      else settings[name] = input.value;
    }
    return settings;
  }

  function clearFieldError() {
    invalidField?.removeAttribute('aria-invalid');
    invalidField?.removeAttribute('aria-describedby');
    invalidField = null;
    formStatus.textContent = '';
  }

  function applySettings(settings) {
    clearFieldError();
    onApply(settings);
    formStatus.textContent = 'Plan updated.';
  }

  byId('audience').addEventListener('change', updateFixedLabel);
  form.addEventListener('input', clearFieldError);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const settings = readForm();
    const issue = profileIssue(settings);
    if (!issue) {
      applySettings(settings);
      return;
    }
    clearFieldError();
    formStatus.textContent = issue.message;
    invalidField = form.elements.namedItem(issue.field);
    if (invalidField) {
      const details = invalidField.closest('details');
      if (details) details.open = true;
      invalidField.setAttribute('aria-invalid', 'true');
      invalidField.setAttribute('aria-describedby', formStatus.id);
      invalidField.focus();
    }
  });

  writeForm(initial);
  mountRoutineDraft((draft) => {
    const settings = { ...readForm(), ...draft };
    const issue = profileIssue(settings);
    if (issue) return issue.message;
    writeForm(settings);
    applySettings(settings);
    return '';
  });
}

function mountRoutineDraft(onApplyDraft) {
  const note = byId('note');
  const button = byId('ask');
  const review = byId('draft-review');
  const status = byId('ai-status');
  let draft = null;
  let pending;

  function showDraft(value) {
    draft = value;
    const items = Object.entries(draft ?? {}).map(([name, setting]) => {
      const item = document.createElement('li');
      const option = choices[name]?.[setting]?.label;
      const text = typeof setting === 'boolean' ? (setting ? 'Yes' : 'No') : option ?? setting;
      item.textContent = `${draftLabels[name]} — ${text}`;
      return item;
    });
    byId('draft-list').replaceChildren(...items);
    review.hidden = !draft;
  }

  function clearPending() {
    pending = null;
    button.removeAttribute('aria-disabled');
  }

  byId('ai-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (pending) return;
    const request = new AbortController();
    pending = request;
    button.setAttribute('aria-disabled', 'true');
    showDraft(null);
    status.textContent = 'Reading your routine…';
    try {
      const response = await fetch('/api/routine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: note.value }),
        signal: request.signal,
      });
      const body = await response.json();
      if (pending !== request) return;
      if (!response.ok) throw new Error(body.error);
      if (!validDraft(body.draft) || !Object.keys(body.draft).length) {
        status.textContent = 'No supported settings found. Add a specific time, duration or travel change.';
        return;
      }
      showDraft(body.draft);
      status.textContent = 'Check the proposed settings before applying them.';
    } catch (error) {
      if (pending === request) status.textContent = responseError(error, 'Gemini is unavailable. You can still update the plan directly.');
    } finally {
      if (pending === request) clearPending();
    }
  });

  note.addEventListener('input', () => {
    if (!draft && !pending) return;
    pending?.abort();
    clearPending();
    showDraft(null);
    status.textContent = 'The note changed. Draft settings again when you’re ready.';
  });

  byId('example-note').addEventListener('click', () => {
    if (note.value.trim()) {
      note.focus();
      status.textContent = 'Clear the current note to load the example.';
      return;
    }
    note.value = 'Pickup is at 4 pm. My 30-minute market errand usually starts at 9 am, but I am free from 11 am to 5 pm. I can replace a 6 km solo drive with the metro.';
    note.focus();
  });

  byId('apply').addEventListener('click', () => {
    if (!draft) return;
    const error = onApplyDraft(draft);
    if (error) {
      status.textContent = error;
      return;
    }
    button.focus();
    showDraft(null);
    status.textContent = 'Reviewed settings applied to the day plan.';
  });
}
