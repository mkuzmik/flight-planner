// Downloads PANSA airspace data (AUP/UUP reservations + static airspace) into
// data/airspace/ so the static site can load it same-origin (PANSA sends no CORS headers).
// Run by the Pages workflow on a schedule; locally: npm run fetch-airspace
import { mkdir, writeFile } from 'node:fs/promises';
import { airacCycles } from '../js/planner.js';

const BASE    = 'https://airspace.pansa.pl';
const OUT_DIR = new URL('../data/airspace/', import.meta.url);
const LAYERS  = {
    'static':   'map-configuration/static-airspace',
    'aup':      'map-configuration/aup',
    'uup':      'map-configuration/uup',
    'aup-next': 'map-configuration/nextAup',
};

async function getJson(path) {
    const resp = await fetch(`${BASE}/${path}`, { headers: { Accept: 'application/json' } });
    if (!resp.ok) throw new Error(`${path}: HTTP ${resp.status}`);
    return resp.json();
}

// Drop map-UI fields (popup HTML, label centroid) to keep the files small;
// coordinates are kept exactly as published
function slim(features, name) {
    if (!Array.isArray(features)) throw new Error(`${name}: expected an array of features`);
    return features
        .filter(f => f?.type === 'Feature' && f.geometry?.coordinates)
        .map(({ properties: { popupHtml, centroid, ...props }, geometry }) => ({
            type: 'Feature',
            properties: props,
            geometry: { type: geometry.type, coordinates: geometry.coordinates },
        }));
}

const config = await getJson('meta/configuration');
await mkdir(OUT_DIR, { recursive: true });

const counts = {};
let airac = [];
for (const [name, path] of Object.entries(LAYERS)) {
    const features = slim(await getJson(path), name);
    if (name === 'static' && !features.length) throw new Error('static airspace layer is empty');
    if (name === 'static') airac = airacCycles(features);
    await writeFile(new URL(`${name}.json`, OUT_DIR), JSON.stringify(features));
    counts[name] = features.length;
}

const meta = {
    fetchedAt:  new Date().toISOString(),
    lastUpdate: config.lastUpdate ?? null,
    // Validity windows in UTC, e.g. { aup: ['2026-10-25 06:00', '2026-10-26 06:00'], ... }
    dates: { static: config.dates?.airspace, aup: config.dates?.aup, uup: config.dates?.uup, 'aup-next': config.dates?.aupNext },
    counts,
    // AIRAC cycles in the static layer, oldest first: [{ start, end }] (ISO, UTC)
    airac,
};
await writeFile(new URL('meta.json', OUT_DIR), JSON.stringify(meta, null, 2));
console.log('Airspace data written:', counts);
