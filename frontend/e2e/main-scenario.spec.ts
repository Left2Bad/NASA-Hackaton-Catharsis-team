import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';

// The main user scenario, end to end, in a real browser: the same steps as the demo
// (docs/demo/README.md). The app runs on the saved answers of the real API, so the
// numbers on screen are compared with those files and not with values written here:
// the test stays valid after `npm run snapshot` refreshes them.

interface SavedCalendar {
  area_km2: number;
  months: { year: number; month: number }[];
  summary: { peak_year: number };
}

const AREA = { id: 'amazon-south', name: 'Southern Amazon' };
const PERIOD = { from: 2010, to: 2020 };

async function savedCalendar(): Promise<SavedCalendar> {
  const file = fileURLToPath(
    new URL(`../public/snapshot/calendar_${AREA.id}.json`, import.meta.url),
  );
  return JSON.parse(await readFile(file, 'utf8')) as SavedCalendar;
}

test.beforeEach(async ({ context, baseURL }) => {
  // The test must not depend on other hosts (map tiles, satellite imagery): requests that
  // leave the app are cut, and the map falls back to its plain grid.
  const origin = new URL(baseURL ?? '').origin;
  await context.route(
    (url) => url.origin !== origin,
    (route) => route.abort(),
  );
});

/**
 * How far the page itself is scrolled, and how far it could be: both are zero on a laptop,
 * where the app is exactly as tall as the window.
 */
const pageScroll = (page: Page) =>
  page.evaluate(() => ({
    scrolled: Math.round(window.scrollY),
    room: document.documentElement.scrollHeight - document.documentElement.clientHeight,
  }));

/** The calendar grid in either mode. */
const grid = (page: Page, name: RegExp) => page.getByRole('grid', { name });

/** Clicks a button of the "Downloads" section and returns the file the browser received. */
async function download(page: Page, button: string) {
  const files = page.getByRole('group', { name: 'Files to download' });
  const [file] = await Promise.all([
    page.waitForEvent('download'),
    files.getByRole('button', { name: button }).click(),
  ]);
  const path = await file.path();
  return { name: file.suggestedFilename(), body: await readFile(path) };
}

test('main scenario: area, calendar, anomalies, now, period, downloads, method, link', async ({
  page,
  context,
}) => {
  const saved = await savedCalendar();

  // 1. The site opens with a prompt and says it runs on saved answers.
  await page.goto('/');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Choose an area to see its fire calendar' }),
  ).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'Saved demo data.' })).toBeVisible();

  // 2. An example area loads its calendar: one cell per month of the record.
  await page.getByRole('button', { name: AREA.name }).click();
  await expect(page.getByRole('heading', { level: 1, name: AREA.name })).toBeVisible();
  await expect(grid(page, /^Fire detections by month/)).toBeVisible();
  await expect(page.locator('[data-month]')).toHaveCount(saved.months.length);
  await expect(page.getByText(`${saved.area_km2.toLocaleString('en-US')} km²`)).toBeVisible();

  // The summary names the most active year of the saved answer.
  const summary = page.getByRole('region', { name: 'Summary' });
  await expect(summary.getByText(String(saved.summary.peak_year), { exact: true })).toBeVisible();

  // The current month is answered in one line above the calendar, and the links of the
  // panel bring a section into view.
  await expect(page.getByTestId('now-headline')).toContainText(/^Now, /);
  const sections = page.getByRole('navigation', { name: 'Sections of the panel' });
  const downloadsHeading = page.getByRole('heading', { level: 2, name: 'Downloads' });
  await expect(downloadsHeading).not.toBeInViewport();
  await sections.getByRole('button', { name: 'Downloads' }).click();
  await expect(downloadsHeading).toBeInViewport();
  // The links stay at the very top of the panel and do not cover the heading they lead to.
  const edges = await page.evaluate(() => {
    const box = (selector: string) => document.querySelector(selector)?.getBoundingClientRect();
    return {
      panelTop: box('section[aria-label="Fire activity"]')?.top ?? -1,
      navTop: box('nav[aria-label="Sections of the panel"]')?.top ?? -2,
      navBottom: box('nav[aria-label="Sections of the panel"]')?.bottom ?? 0,
      headingTop: box('#downloads-heading')?.top ?? -1,
    };
  });
  expect(Math.round(edges.navTop)).toBe(Math.round(edges.panelTop));
  expect(edges.headingTop).toBeGreaterThanOrEqual(edges.navBottom);

  // On a laptop only the panel scrolls. The page itself must stay where it is: the header
  // keeps its place, and no empty space opens under the app.
  await expect(page.getByRole('link', { name: 'Burn Calendar' })).toBeInViewport();
  expect(await pageScroll(page)).toEqual({ scrolled: 0, room: 0 });
  await sections.getByRole('button', { name: 'Calendar' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Burn calendar' })).toBeInViewport();

  // 3. The anomaly mode recolors the same calendar.
  const modes = page.getByRole('group', { name: 'Calendar mode' });
  await modes.getByRole('button', { name: 'Anomaly' }).click();
  await expect(modes.getByRole('button', { name: 'Anomaly' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(grid(page, /^Fire anomalies by month/)).toBeVisible();

  // The "original sensors" view shows the same months before harmonization: the saved
  // answers carry the raw counts, so it works without a server too.
  await modes.getByRole('button', { name: 'Original sensors' }).click();
  await expect(grid(page, /^Fire detections by month as the sensors recorded them/)).toBeVisible();
  await modes.getByRole('button', { name: 'Anomaly' }).click();
  await expect(grid(page, /^Fire anomalies by month/)).toBeVisible();
  // Single hot spots need a server: this copy of the app does not offer them.
  await expect(page.getByText('Click a month to see its hot spots on the map.')).toHaveCount(0);

  // 4. The "Now" panel compares the current month with the usual one.
  const now = page.getByRole('region', { name: 'Now' });
  await expect(now.getByRole('list', { name: 'Levels for these days of the month' })).toBeVisible();
  await expect(now.locator('svg').first()).toBeVisible();

  // 5. A shorter period: the calendar and both charts follow it.
  const period = page.getByRole('group', { name: 'Period' });
  await period.getByLabel('From').selectOption(String(PERIOD.from));
  await period.getByLabel('to').selectOption(String(PERIOD.to));
  await expect(
    grid(page, new RegExp(`^Fire anomalies by month, ${PERIOD.from} to ${PERIOD.to}`)),
  ).toBeVisible();
  const months = (PERIOD.to - PERIOD.from + 1) * 12;
  await expect(page.locator('[data-month]')).toHaveCount(months);
  await expect(page.getByRole('region', { name: 'Season profile' }).locator('svg')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Yearly totals' }).locator('svg')).toBeVisible();

  // The daily calendar of a year of the period: a cell for every day of a leap year.
  const daily = page.getByRole('region', { name: 'Daily calendar' });
  await daily.getByLabel('Year').selectOption('2020');
  await expect(daily.getByRole('grid', { name: /^Fire detections by day, 2020/ })).toBeVisible();
  await expect(daily.locator('[data-day]')).toHaveCount(366);

  // The address now describes the view.
  const view = `area=${AREA.id}&from=${PERIOD.from}&to=${PERIOD.to}&mode=anomaly`;
  await expect(page).toHaveURL(new RegExp(`#/\\?${view}$`));

  // 6. Downloads: the monthly table as CSV and the calendar as PNG.
  const years = `${PERIOD.from}-${PERIOD.to}`;
  const table = await download(page, 'Monthly table (CSV)');
  expect(table.name).toBe(`firms-calendar_${AREA.id}_${years}.csv`);
  const rows = table.body.toString('utf8').trimEnd().split('\n');
  expect(rows[0]).toMatch(/^year,month,/);
  expect(rows).toHaveLength(1 + months);
  expect(rows[1]).toMatch(new RegExp(`^${PERIOD.from},1,`));

  const image = await download(page, 'Calendar (PNG)');
  expect(image.name).toBe(`firms-calendar-anomaly_${AREA.id}_${years}.png`);
  // The PNG signature, and a size no empty canvas would have.
  expect(image.body.subarray(1, 4).toString('latin1')).toBe('PNG');
  expect(image.body.byteLength).toBeGreaterThan(20_000);

  // 7. The "Method" page shows what harmonization changes and how it was checked.
  await page
    .getByRole('navigation', { name: 'Sections' })
    .getByRole('link', { name: 'Method' })
    .click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'How the record is made' }),
  ).toBeVisible();
  const effect = page.getByRole('region', { name: 'What harmonization changes' });
  await expect(effect.locator('svg').first()).toBeVisible();
  const checks = page.getByRole('region', { name: 'How it was checked' });
  await expect(checks.locator('svg').first()).toBeVisible();
  await expect(
    checks.getByRole('heading', { level: 3, name: 'The seams of the record' }),
  ).toBeVisible();
  expect(await pageScroll(page)).toEqual({ scrolled: 0, room: 0 });

  // The page of the color scales scrolls inside the app as well.
  await page
    .getByRole('navigation', { name: 'Sections' })
    .getByRole('link', { name: 'Color scales' })
    .click();
  await expect(page.getByRole('heading', { level: 1, name: 'Color scales' })).toBeVisible();
  await expect(page.getByRole('img', { name: /, 2008 to 2013, / }).first()).toBeVisible();
  expect(await pageScroll(page)).toEqual({ scrolled: 0, room: 0 });

  // Back on the calendar the view is the one that was left.
  await page
    .getByRole('navigation', { name: 'Sections' })
    .getByRole('link', { name: 'Calendar' })
    .click();
  await expect(page.getByRole('heading', { level: 1, name: AREA.name })).toBeVisible();
  await expect(page.locator('[data-month]')).toHaveCount(months);

  // 8. The link reopens the same view in a new tab.
  const shared = await context.newPage();
  await shared.goto(page.url());
  await expect(shared.getByRole('heading', { level: 1, name: AREA.name })).toBeVisible();
  await expect(
    grid(shared, new RegExp(`^Fire anomalies by month, ${PERIOD.from} to ${PERIOD.to}`)),
  ).toBeVisible();
  await expect(shared.getByRole('button', { name: AREA.name })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});

test('the same view fits a phone 360 px wide without scrolling sideways', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto(`/#/?area=${AREA.id}&mode=anomaly`);
  await expect(grid(page, /^Fire anomalies by month/)).toBeVisible();
  await expect(page.getByRole('region', { name: 'Yearly totals' }).locator('svg')).toBeVisible();

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
