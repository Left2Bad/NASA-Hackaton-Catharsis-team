// Takes the frames of the pitch video from the live site, 1920x1080 at 2x pixel density,
// and writes the boxes (CSS px of the 1920x1080 view) of the things the video zooms to or clicks.
// Run from the repo's frontend/ folder (it has @playwright/test):
//   node <this file> <outDir>
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
const { chromium } = createRequire(`${process.cwd()}/`)('@playwright/test');

const out = process.argv[2];
const SITE = 'https://nasa.pin-planet.org/';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', args: ['--lang=en-US'] });
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2, locale: 'en-US' });
const page = await context.newPage();
const boxes = {};

const settle = (ms = 3500) => page.waitForTimeout(ms);
async function go(hash, ms = 6000) {
  await page.goto(`${SITE}?v=${Date.now()}${hash}`);
  await settle(ms);
}
async function box(name, locator) {
  const b = await locator.first().boundingBox();
  if (!b) throw new Error(`no box for ${name}`);
  boxes[name] = { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) };
}
async function shot(name) {
  await page.mouse.move(1919, 1079);
  await page.screenshot({ path: `${out}/${name}.jpg`, type: 'jpeg', quality: 90 });
  console.log(name);
}
/** Scrolls the nearest scroller so the element's top sits `gap` px below the scroller's top. */
async function scrollTo(locator, gap = 70) {
  await locator.first().evaluate((el, g) => {
    let s = el.parentElement;
    while (s && !/auto|scroll/.test(getComputedStyle(s).overflowY)) s = s.parentElement;
    const target = s ?? document.scrollingElement;
    const top = s ? s.getBoundingClientRect().top : 0;
    target.scrollTop += el.getBoundingClientRect().top - top - g;
  }, gap);
  await settle(800);
}

// 1. Start screen: the world map, no area yet.
await go('#/');
await box('start_presets', page.getByRole('group', { name: 'Example areas' }));
await box('start_california', page.getByRole('button', { name: 'Northern California' }));
await shot('01-start');

// 2. Northern California, sensors as recorded: the 2012 step.
await go('#/?area=california-north&mode=raw', 8000);
await box('raw_grid', page.getByRole('grid'));
for (const id of ['2011-06', '2012-06', '2012-02', '2011-12', '2013-08', '2010-08']) {
  await box(`raw_${id}`, page.locator(`[data-month="${id}"]`));
}
await box('raw_modes', page.getByRole('group', { name: 'Calendar mode' }));
await shot('02-raw');

// 3. The same calendar, harmonized.
await page.getByRole('group', { name: 'Calendar mode' }).getByRole('button', { name: 'Detections' }).click();
await settle(3000);
await box('harm_grid', page.getByRole('grid'));
for (const id of ['2011-06', '2012-06', '2012-02', '2011-12', '2020-09', '2021-08', '2026-10']) {
  await box(`harm_${id}`, page.locator(`[data-month="${id}"]`));
}
await box('harm_modes', page.getByRole('group', { name: 'Calendar mode' }));
await box('harm_map', page.locator('.maplibregl-canvas'));
await box('harm_spotsbar', page.getByRole('button', { name: 'Download CSV' }));
await box('harm_slider', page.getByRole('group', { name: 'Months on the map' }));
await box('harm_title', page.getByRole('heading', { name: 'Northern California' }));
await box('harm_now', page.getByText(/^Now, /));
await shot('03-harm');

// 4. The anomaly view.
await page.getByRole('group', { name: 'Calendar mode' }).getByRole('button', { name: 'Anomaly' }).click();
await settle(2500);
await box('anom_grid', page.getByRole('grid'));
await shot('04-anomaly');
await page.getByRole('group', { name: 'Calendar mode' }).getByRole('button', { name: 'Detections' }).click();
await settle(1500);

// 5. "Now": the current month against the same days of earlier years.
await scrollTo(page.getByRole('heading', { name: 'Now', exact: true }));
await box('now_heading', page.getByRole('heading', { name: 'Now', exact: true }));
await box('now_level', page.getByText(/against the median of the same days/).last());
await box('now_chart', page.getByText('Detections accumulated since the start of the month', { exact: true }).last());
await shot('05-now');

// 6. Season profile and yearly totals.
await scrollTo(page.getByRole('heading', { name: 'Season profile', exact: true }));
await box('season_heading', page.getByRole('heading', { name: 'Season profile', exact: true }));
await box('years_heading', page.getByRole('heading', { name: 'Yearly totals', exact: true }));
await shot('06-season');

// 7. Downloads.
await scrollTo(page.getByRole('heading', { name: 'Downloads', exact: true }));
await box('dl_heading', page.getByRole('heading', { name: 'Downloads', exact: true }));
await box('dl_points', page.getByRole('button', { name: 'Hot spots (CSV)' }));
await box('dl_png', page.getByRole('button', { name: 'Calendar (PNG)' }));
await shot('07-downloads');

// 8. Method: what harmonization changes, Northern California.
await go('#/method', 6000);
const area = page.getByRole('combobox').first();
await area.selectOption({ label: 'Northern California' }).catch(async () => area.selectOption('california-north'));
await settle(2000);
await scrollTo(page.getByRole('heading', { name: 'What harmonization changes' }), 40);
await box('m_harm_heading', page.getByRole('heading', { name: 'What harmonization changes' }));
await box('m_harm_figure', page.locator('figure').first());
await shot('08-method-harm');

// 9. Method: the check on held-out years and the seams table.
await scrollTo(page.getByRole('heading', { name: 'Northern California', level: 3 }), 40);
await box('m_val_heading', page.getByRole('heading', { name: 'Northern California', level: 3 }));
await box('m_val_figure', page.locator('figure').nth(3));
await shot('09-method-val');
await scrollTo(page.getByRole('heading', { name: 'The seams of the record' }), 120);
await box('m_seams_heading', page.getByRole('heading', { name: 'The seams of the record' }));
await box('m_seams_table', page.getByRole('table').filter({ hasText: 'Naive splice' }));
await shot('10-method-seams');

await writeFile(`${out}/boxes.json`, JSON.stringify(boxes, null, 1));
await browser.close();
console.log('boxes', Object.keys(boxes).length);
