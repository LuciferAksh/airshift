# AirShift

AirShift helps families and community organizers make a workable plan for a winter smog day. It preserves fixed commitments, compares hourly outdoor conditions for flexible activities and explains indoor and travel changes in plain language.

## Run locally

Use Node.js 22 or newer. The application has no runtime dependencies.

```sh
npm start
npm test
npm run coverage
```

To verify a clean checkout, run these commands from the repository root.

```sh
npm ci
npm run typecheck
npm run coverage
npm run build:sites
npm run verify:worker
```

Strict TypeScript checking covers the JavaScript planner, forecast parsing and caching, recommendation contracts, Gemini adapter, and shared HTTP handler. The Worker bundle is written to `dist/server/` and builds without the private hosting manifest. The Worker check runs that artifact and requests every registered asset. GitHub Actions runs these checks on every push and pull request.

## Deploy on Vercel

Import the repository as a Node.js project. Vercel detects the root `server.ts` entry, which starts the same HTTP handler used locally. Set `GEMINI_API_KEY` as a production secret and redeploy. Set `GEMINI_MODEL` only when overriding the default model. Verify the production domain from a signed-out browser with a live forecast and both Gemini actions.

Open `http://127.0.0.1:4176`. New Delhi’s current modeled AQI and tomorrow’s forecast load by default. Search for a city or postal code or click **Detect my location** to use your approximate position. Open-Meteo receives the city search and the forecast uses rounded coordinates. Gemini receives no coordinates or location lookup terms. Community notices may show a selected city name and omit detected coordinates. The server keeps a bounded in-memory forecast cache. For a deterministic walkthrough, open `http://127.0.0.1:4176/?sample=1`. The sample uses New Delhi and switching back restores the selected live location. For a hosted Node runtime, set `HOST=0.0.0.0` and use the platform’s `PORT`.

To enable Gemini, copy `.env.example` to `.env` and supply a dedicated `GEMINI_API_KEY`, or set that secret in the hosting environment. Restart after changing configuration. **Draft settings** parses a routine for review before applying it. **Personalize recommendations with Gemini** sends feasible schedule, indoor and travel choices with the user's priorities for ranking. Gemini returns action IDs and a short personalized rationale. The app validates the choices and computes the displayed impacts. Both actions require a click, and the forecast-based plan remains usable during provider outages.

To run the browser release check, install development dependencies with `npm ci`, keep `npm start` running, and use the following commands in the checkout. The browser test simulates Gemini’s response and checks live forecasts, forced forecast fallback, permission denial and axe accessibility on desktop and mobile. A live Gemini request is a separate release check.

```sh
npx --package @playwright/cli playwright-cli install-browser chromium
npx --package @playwright/cli playwright-cli -s=airshift-check open http://127.0.0.1:4176
npx --package @playwright/cli playwright-cli -s=airshift-check run-code --filename scripts/verify-browser.cjs
npx --package @playwright/cli playwright-cli -s=airshift-check close
```

## How to evaluate the prototype

1. Open `/?sample=1` for the New Delhi sample. School pickup remains at 15:00. The market errand shifts from 09:00 to 14:00, changing the outdoor particle exposure proxy from 99 to 36 µg·h/m³, about 64% lower for that activity. These are simulated conditions.
2. Open **Lower-emission travel options**, select **Replace a solo drive with rail**, enter `6` km and update. This records the entered solo car distance separately from the outdoor particle comparison.
3. Select **Community group** and update. The sample is too polluted for the group’s outdoor activity under the default settings. Confirm an available indoor venue under the indoor options, update and review the copyable notice.
4. Switch to **Tomorrow’s forecast** and change the city or detect your location. Check the current US AQI, PM₂.₅, PM₁₀, main modeled AQI contributor and source time. Compare them with tomorrow’s date and hourly values. The methods section links to India’s CPCB AQI and local advisories.
5. With Gemini configured, enter `Pickup is at 4 pm. My 30-minute errand is usually at 9 am, but I’m free from 11 am to 5 pm.` Confirm that the displayed plan changes only after applying the draft.

## Implementation

| Boundary | Responsibility |
| --- | --- |
| `public/planner.mjs`, `types/airshift.d.ts` | Validate routine settings and share typed contracts for forecasts and recommendations. The planner evaluates each eligible window once, then selects the lowest-exposure option and a bounded alternative closer to the usual time. It computes impact from the selected plan. |
| `public/app.mjs` | Coordinates the applied routine, current forecast and validated recommendation. |
| `public/forecast-ui.mjs`, `public/places.mjs` | Manage location and forecast requests, render current readings, and expose the hourly data as a table and a chart. |
| `public/routine-ui.mjs` | Maps form inputs to settings, guides users to invalid fields, and lets them review Gemini drafts before applying them. |
| `public/plan-view.mjs`, `public/recommendations-ui.mjs` | Render impact estimates, the community notice and Gemini's selected recommendations using text nodes. |
| `public/air-data.mjs`, `server/forecast.mjs` | Validate current conditions and tomorrow’s forecast from Open-Meteo. The Node cache shares refreshes across concurrent callers, including when the forecast date rolls over. The hosted build requests the browser forecast first. |
| `server/gemini.mjs` | Validates Gemini responses against the expected draft or recommendation contract. An upstream HTTP 503 allows one retry within the original request deadline. |
| `public/recommendations.mjs`, `server/gemini.mjs` | Build bounded recommendations from eligible intervals and declared options. Gemini selects existing action IDs and writes the rationale. The same contract checks the result before the browser displays it. |
| `server/http.mjs` | Serves an allowlist of assets, validates inbound requests and limits location and Gemini requests. The 40-call Gemini hourly quota is per process or Worker isolate. |
| `server/app.mjs`, `server/worker.mjs` | Connect the same application handler to Node HTTP and hosted Workers respectively. |

The sample contains synthetic hourly PM₂.₅ and AQI values. The outdoor comparison is the time-weighted sum of regional forecast PM₂.₅ over the flexible activity. A postponement or move indoors reports the outdoor minutes removed. Car travel uses the user’s entered distance and indoor actions explain mechanisms qualitatively. Citywide forecasts can miss local pollution, indoor air quality depends on the actual space, and local guidance can supersede the plan. The group planning limits are conservative product rules informed by [AirNow school activity guidance](https://www.airnow.gov/publications/activity-guides/air-quality-and-outdoor-activity-guidance-for-schools/). Forecast data is attributed to [Open-Meteo](https://open-meteo.com/en/docs/air-quality-api) and [CAMS](https://atmosphere.copernicus.eu/).

The hero is conceptual artwork generated with built-in ImageGen. The prompt requested a wide editorial photograph of an elevated metro in a hazy northern Indian city at winter dawn, with a dark forest-green grade and muted amber horizon.
