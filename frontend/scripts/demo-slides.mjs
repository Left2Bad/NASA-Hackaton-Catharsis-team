// Prints the pitch deck (docs/demo/slides/slides.html) into a PDF, one page per slide.
//
//   npm run demo:slides                 -> docs/demo/slides/burn-calendar-pitch.pdf
//   npm run demo:slides -- <folder>     -> also saves every slide as a PNG into <folder>
//
// The deck uses the typeface of the app, taken from node_modules, so the PDF looks the
// same on any machine.

import { mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';

const folder = fileURLToPath(new URL('../../docs/demo/slides/', import.meta.url));
const font = fileURLToPath(
  new URL(
    '../node_modules/@fontsource-variable/geologica/files/geologica-latin-wght-normal.woff2',
    import.meta.url,
  ),
);
const previews = process.argv[2];

const browser = await chromium.launch();
// Twice the pixels, so the photographed backgrounds stay sharp on a large screen.
const page = await browser.newPage({
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: 2,
});
await page.goto(pathToFileURL(`${folder}slides.html`).href);

// The font goes into the page as a data URI: a file page may not read other folders.
const fontData = (await readFile(font)).toString('base64');
await page.addStyleTag({
  content: `@font-face {
    font-family: 'Geologica Variable';
    font-weight: 100 900;
    src: url(data:font/woff2;base64,${fontData}) format('woff2-variations');
  }`,
});
await page.evaluate(() => document.fonts.ready);
// Every picture must be loaded: a missing frame would leave an empty box on a slide.
const broken = await page.evaluate(() =>
  Array.from(document.images)
    .filter((image) => !image.complete || image.naturalWidth === 0)
    .map((image) => image.getAttribute('src')),
);
if (broken.length > 0) {
  throw new Error(`Frames not found: ${broken.join(', ')}. Run "npm run demo:shots" first.`);
}

const slides = page.locator('.slide');
const count = await slides.count();

// The artwork of a slide (blurred backdrop, veil, flames, embers, glass panels, glows) is live
// SVG and CSS. Printed as it is, it turns into hundreds of gradients, soft masks and shadows per
// page, and a PDF viewer redraws them slowly on every slide change. So each slide is photographed
// once without its words and screenshots, and that picture becomes its background: the PDF then
// holds one JPEG per slide, the screenshots and real text on top.
const bare = await page.addStyleTag({
  content: `.slide, .slide *, .slide li::marker, .steps li::before { color: transparent !important }
    .crop img { visibility: hidden }`,
});
const backgrounds = [];
for (let index = 0; index < count; index += 1) {
  const shot = await slides.nth(index).screenshot({ type: 'jpeg', quality: 90 });
  backgrounds.push(`data:image/jpeg;base64,${shot.toString('base64')}`);
}
await bare.evaluate((style) => style.remove());
await page.addStyleTag({
  content: `.fx { display: none }
    .slide > div, .foot span { background: none !important; border-color: transparent !important; box-shadow: none !important }
    .steps li::before, .kicker::before { background: none; box-shadow: none }
    th, td { border-color: transparent }`,
});
await page.evaluate((pictures) => {
  document.querySelectorAll('.slide').forEach((slide, index) => {
    slide.style.background = `url(${pictures[index]}) 0 0 / 100% 100% no-repeat`;
  });
}, backgrounds);

if (previews) {
  await mkdir(previews, { recursive: true });
  for (let index = 0; index < count; index += 1) {
    await slides.nth(index).screenshot({ path: `${previews}/slide-${index + 1}.png` });
  }
}

await page.pdf({
  path: `${folder}burn-calendar-pitch.pdf`,
  width: '1920px',
  height: '1080px',
  printBackground: true,
});
await browser.close();
console.log(`${count} slides -> ${folder}burn-calendar-pitch.pdf`);
