import { defaults } from './catalog.mjs';
import { mountForecast } from './forecast-ui.mjs';
import { mountCommunityNotice, renderPlan } from './plan-view.mjs';
import { mountRecommendations } from './recommendations-ui.mjs';
import { mountRoutine } from './routine-ui.mjs';

let profile = defaults();
let forecast = null;
let recommendation = null;

function drawPlan() {
  forecastUI.highlight(renderPlan(profile, forecast, recommendation));
}

function resetRecommendations() {
  recommendation = null;
  recommendationUI.reset();
  drawPlan();
}

const forecastUI = mountForecast((value) => {
  forecast = value;
  resetRecommendations();
});

const recommendationUI = mountRecommendations(
  () => forecast && { profile, hours: forecast.hours, mode: forecast.mode },
  (selection) => {
    recommendation = selection;
    drawPlan();
  },
);

mountRoutine(profile, (settings) => {
  profile = settings;
  resetRecommendations();
});
mountCommunityNotice();
forecastUI.start();
