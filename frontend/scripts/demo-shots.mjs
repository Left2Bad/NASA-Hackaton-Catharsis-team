// Takes the frames of the demo (docs/demo/README.md) from the running app, so they can be
// taken again after any change of the interface.
//
//   npm run demo:shots                          -> the app at http://localhost:5173
//   npm run demo:shots -- http://localhost:5174 -> the app that talks to the real API
//
// The app must show real numbers: start it against the real API (`npm run dev:api`) or
// build it on the saved answers (VITE_API_FALLBACK=only). The frames go to
// docs/demo/screenshots/ as demo-NN-*.jpg, 1920 x 1200.

import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const app = (process.argv[2] ?? 'http://localhost:5173').replace(/\/+$/, '');
const out = fileURLToPath(new URL('../../docs/demo/screenshots/', import.meta.url));

// The area of the demo and the year shown over the typical season.
const AREA = 'california-north';
const AREA_NAME = 'Northern California';
const SEASON_YEAR = '2020';

await mkdir(out, { recursive: true });
const browser = await chromium.launch();

async function open(width, height, scale) {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: scale,
  });
  return context.newPage();
}

async function shot(page, name) {
  await page.screenshot({ path: `${out}${name}.jpg`, type: 'jpeg', quality: 88 });
  console.log(`${name}.jpg`);
}

/**
 * Scrolls the page so that the section with this heading starts at the top of its scroller,
 * under the jump links of the panel, which stay there.
 */
async function showSection(page, heading, offset = 64) {
  await page.getByRole('heading', { name: heading, exact: true }).evaluate((element, gap) => {
    let scroller = element.parentElement;
    while (scroller && !/auto|scroll/.test(getComputedStyle(scroller).overflowY)) {
      scroller = scroller.parentElement;
    }
    const target = scroller ?? document.scrollingElement;
    const top = scroller ? scroller.getBoundingClientRect().top : 0;
    target.scrollTop += element.getBoundingClientRect().top - top - gap;
  }, offset);
  await page.waitForTimeout(300);
}

/** Map tiles and fonts arrive from other hosts: give them a moment. */
const settle = (page, ms = 3500) => page.waitForTimeout(ms);

// ---------- Laptop ----------

const page = await open(1280, 800, 1.5);

await page.goto(`${app}/`);
await page.getByRole('heading', { name: 'Choose an area to see its fire calendar' }).waitFor();
await settle(page);
await shot(page, 'demo-01-start');

await page.getByRole('button', { name: AREA_NAME }).click();
await page.getByRole('grid', { name: /^Fire detections by month/ }).waitFor();
await page.getByRole('region', { name: 'Now' }).getByRole('list').first().waitFor();
await settle(page);
await shot(page, 'demo-02-calendar');

// A cell under the pointer: the tooltip with the exact numbers. The calendar is brought
// to the top of the panel first, so the tooltip has room inside the frame.
await showSection(page, 'Burn calendar');
await page.locator('[data-month="2020-09"]').hover();
// The tooltip repeats the spoken label of the cell, so it is hidden from the accessibility tree.
await page.locator('[role="tooltip"]').waitFor();
await shot(page, 'demo-03-tooltip');
await page.mouse.move(700, 120);

await page
  .getByRole('group', { name: 'Calendar mode' })
  .getByRole('button', { name: 'Anomaly' })
  .click();
await page.getByRole('grid', { name: /^Fire anomalies by month/ }).waitFor();
await page.waitForTimeout(300);
await shot(page, 'demo-04-anomaly');

await showSection(page, 'Summary');
await shot(page, 'demo-05-summary-now');

await page
  .getByRole('region', { name: 'Season profile' })
  .getByLabel('Year over the typical season')
  .selectOption(SEASON_YEAR);
await showSection(page, 'Season profile');
await shot(page, 'demo-06-season-yearly');

await showSection(page, 'Downloads');
await shot(page, 'demo-07-downloads');

await page
  .getByRole('navigation', { name: 'Sections' })
  .getByRole('link', { name: 'Method' })
  .click();
await page.getByRole('heading', { name: 'How the record is made' }).waitFor();
const effect = page.getByRole('region', { name: 'What harmonization changes' });
await effect.locator('svg').first().waitFor();
await effect.getByLabel('Area').selectOption({ label: AREA_NAME });
await effect.getByRole('figure', { name: `Fire detections per year, ${AREA_NAME}` }).waitFor();
await page.waitForTimeout(500);
await shot(page, 'demo-08-method-harmonization');

await page.getByRole('heading', { name: 'The seams of the record' }).waitFor();
await showSection(page, 'How it was checked');
await shot(page, 'demo-09-method-validation');

await showSection(page, 'The seams of the record');
await shot(page, 'demo-10-method-seams');

await page.context().close();

// ---------- Phone ----------

const phone = await open(360, 740, 3);
await phone.goto(`${app}/#/?area=${AREA}&mode=anomaly`);
await phone.getByRole('grid', { name: /^Fire anomalies by month/ }).waitFor();
await settle(phone, 2500);
await phone.getByRole('heading', { name: AREA_NAME }).scrollIntoViewIfNeeded();
await phone.evaluate(() => {
  const heading = document.querySelector('h1');
  window.scrollTo(0, window.scrollY + (heading?.getBoundingClientRect().top ?? 0) - 12);
});
await phone.waitForTimeout(300);
await shot(phone, 'demo-11-phone');
await phone.context().close();

await browser.close();
console.log(`\nFrames are in ${out}`);
