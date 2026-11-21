import { audiences, flexibleActivity, travelOptions } from './catalog.mjs';
import { activityNotice, aqiBand, formatTime, makePlan } from './planner.mjs';
import { byId, number, setText } from './dom.mjs';

function renderFlexible(plan, profile, recommendation) {
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

export function renderPlan(profile, forecast, recommendation) {
  byId('result-content').hidden = !forecast;
  byId('result-empty').hidden = Boolean(forecast);
  setText('audience-pill', audiences[profile.audience].label);
  if (!forecast) return null;

  const plan = makePlan(profile, forecast, recommendation);
  const labels = audiences[profile.audience];
  setText('fixed-title', `${labels.fixed} stays at ${profile.fixedTime}`);
  const peak = Math.round(plan.fixed.peak);
  const band = aqiBand(plan.fixed.peak).label.toLowerCase();
  const guidance = plan.fixed.peak > 100 ? ' Keep the outdoor wait as short as practical and follow local advisories.' : ' Recheck conditions before leaving.';
  setText('fixed-reason', `Peak forecast US AQI ${peak} (${band}) during the fixed slot.${guidance}`);
  renderFlexible(plan, profile, recommendation);
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
  return plan.best ? Math.floor(plan.best.start / 60) : null;
}

export function mountCommunityNotice() {
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
}
