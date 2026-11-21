async (page) => {
  const origin = 'http://127.0.0.1:4176';
  const context = page.context();
  await context.grantPermissions(['geolocation', 'clipboard-read', 'clipboard-write'], { origin });
  await context.setGeolocation({ latitude: 19.076, longitude: 72.8777 });
  await context.addInitScript({ path: 'node_modules/axe-core/axe.min.js' });

  const heading = (name) => page.getByRole('heading', { name, exact: true }).waitFor();
  const click = (name) => page.getByRole('button', { name, exact: true }).click();
  const access = async () => {
    const violations = await page.evaluate(async () => (await axe.run()).violations.map(({ id }) => id));
    if (violations.length) throw new Error(`Accessibility violations: ${violations.join(', ')}`);
  };

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${origin}/?sample=1`);
  await heading('Move market errand to 14:00');
  await page.getByText('64% lower', { exact: true }).waitFor();
  await page.getByRole('combobox', { name: 'Prioritize', exact: true }).selectOption('schedule');
  await page.getByRole('combobox', { name: 'Main indoor concern', exact: true }).selectOption('cooking');
  await page.getByLabel('Rail or metro can replace my solo drive').check();
  await page.route('**/api/recommendations', (route) => route.fulfill({ json: {
    recommendation: { schedule: 'closer', indoor: 'cooking', travel: 'transit', rationale: 'The earlier slot and lower smoke meal fit the preferences you entered.' },
  } }));
  await click('Personalize recommendations with Gemini');
  await page.getByText('Personalized by Gemini', { exact: true }).waitFor();
  await heading('Move market errand to 12:49');
  await heading('Choose a meal that needs less frying');
  await heading('Replace the solo drive with a train or metro');
  await page.getByText('Distance needed', { exact: true }).waitFor();
  await page.getByRole('combobox', { name: 'Prioritize', exact: true }).selectOption('exposure');
  await heading('Move market errand to 14:00');
  await page.getByText('View hourly data table', { exact: true }).click();
  if (await page.getByRole('row').count() !== 25) throw new Error('The hourly table should show one header and 24 readings');

  await page.getByText('Lower-emission travel options', { exact: true }).click();
  await page.getByLabel('Travel change').selectOption('transit');
  await page.getByLabel('Solo car distance avoided (km)').fill('6');
  await click('Update day plan');
  await page.getByText('6 km', { exact: true }).waitFor();

  await page.getByLabel('Who are you planning for?').selectOption('community');
  await click('Update day plan');
  await heading('Postpone outdoor group activity');
  await page.getByText('Outdoor minutes and indoor options', { exact: true }).click();
  await page.getByLabel('An indoor option for exercise, play or group activities is available').check();
  await click('Update day plan');
  await heading('Move outdoor group activity indoors');
  await page.getByText('Prepare a community notice', { exact: true }).click();
  await click('Copy notice');
  const notice = await page.evaluate(() => navigator.clipboard.readText());
  if (!notice.includes('demonstration only') || notice.includes('15:00')) throw new Error('Notice must label the sample and exclude fixed commitments');

  await page.getByText('Describe your routine with Gemini', { exact: true }).click();
  await click('Use example');
  await page.route('**/api/routine', (route) => route.fulfill({ status: 200, json: { draft: { fixedTime: '16:00' } } }));
  await click('Draft settings');
  await page.getByText('Fixed start — 16:00').waitFor();
  await page.getByLabel('Routine to turn into plan settings').fill('The supply pickup is at 4 pm.');
  await page.getByText('The note changed.', { exact: false }).waitFor();
  if (await page.getByRole('button', { name: 'Apply reviewed settings' }).isVisible()) throw new Error('Editing the note must invalidate its draft');
  await click('Draft settings');
  await heading('Essential supply pickup stays at 15:00');
  await click('Apply reviewed settings');
  await heading('Essential supply pickup stays at 16:00');
  await access();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${origin}/?sample=1`);
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  if (await page.evaluate(() => document.activeElement.id) !== 'workspace') throw new Error('Skip link must focus the planner');
  await page.route('**/api/location', (route) => route.fulfill({ status: 503, json: { error: 'Unavailable for this test' } }));
  const direct = page.waitForRequest((request) => request.url().startsWith('https://air-quality-api.open-meteo.com/'));
  await click('Detect my location');
  const query = new URL((await direct).url()).searchParams;
  if (query.get('latitude') !== '19.1' || query.get('longitude') !== '72.9') throw new Error('Location coordinates must be rounded');
  await page.locator('#forecast-status').filter({ hasText: /Your location.*Retrieved/ }).waitFor({ timeout: 24000 });
  if (await page.locator('#active-location').textContent() !== 'Your location') throw new Error('Detected location must be visible by the search');
  await page.getByText('Open-Meteo / CAMS model estimate', { exact: false }).waitFor();
  if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw new Error('Mobile page has horizontal overflow');
  await access();

  if (await page.getByRole('combobox', { name: 'Location', exact: true }).count()) throw new Error('Location search is the single manual picker');
  await page.getByLabel('Find a city or postal code').fill('Pune, India');
  await click('Search cities');
  await click('Pune, Maharashtra, India');
  await page.locator('#forecast-status').filter({ hasText: /Pune, Maharashtra, India.*Retrieved/ }).waitFor({ timeout: 24000 });
  if (await page.locator('#active-location').textContent() !== 'Pune, Maharashtra, India') throw new Error('Selected city must be visible by the search');
  const mode = page.getByRole('combobox', { name: 'Forecast type', exact: true });
  await mode.selectOption('sample');
  await page.getByText('New Delhi · sample', { exact: true }).waitFor();
  await mode.selectOption('forecast');
  await page.locator('#forecast-status').filter({ hasText: /Pune, Maharashtra, India.*Retrieved/ }).waitFor({ timeout: 24000 });

  await context.addInitScript(() => {
    navigator.geolocation.getCurrentPosition = (_success, denied) => denied({ code: 1 });
  });
  await page.goto(`${origin}/?sample=1`);
  await click('Detect my location');
  await page.getByText('Location permission was declined.', { exact: false }).waitFor();
  await heading('Move market errand to 14:00');
}
