// Saves answers of the running API as static files for the fallback mode of the app.
//
//   npm run snapshot                       -> asks http://localhost:8000/api/v1
//   npm run snapshot -- https://host/api/v1
//
// The files go to public/snapshot/ and are served next to the app. They must come from an
// API that runs on the real FIRMS record: the fallback shows them to users as real numbers.
// The script refuses data whose version looks synthetic.

import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const api = (process.argv[2] ?? process.env.VITE_API_URL ?? 'http://localhost:8000/api/v1').replace(
  /\/+$/,
  '',
);
const out = fileURLToPath(new URL('../public/snapshot/', import.meta.url));

async function call(path, body) {
  const response = await fetch(`${api}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    throw new Error(
      `${path} answered ${response.status}: ${(await response.text()).slice(0, 200)}`,
    );
  }
  return response.json();
}

async function save(name, data) {
  // Compact JSON: the files are read by the app, not by people.
  const text = JSON.stringify(data);
  await writeFile(`${out}${name}.json`, text);
  console.log(`${name}.json  ${(text.length / 1024).toFixed(1)} KB`);
}

const meta = await call('/meta');
if (/synthetic|example|test/i.test(meta.data_version)) {
  throw new Error(`Data version "${meta.data_version}" is not the real record. Snapshot refused.`);
}

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

await save('meta', meta);
await save('validation', await call('/method/validation'));
for (const preset of meta.presets) {
  // `series=raw` adds the raw sensor counts to every month, so one file serves both
  // the calendar and the "Method" page. The whole record is saved; the app cuts periods.
  await save(
    `calendar_${preset.id}`,
    await call('/calendar', { geometry: preset.geometry, series: 'raw' }),
  );
  await save(`current_${preset.id}`, await call('/current', { geometry: preset.geometry }));
}
await save('index', {
  created_at: new Date().toISOString(),
  data_version: meta.data_version,
  areas: meta.presets.map((preset) => preset.id),
});

console.log(`\n${(await readdir(out)).length} files in public/snapshot/, from ${api}`);
