// ── Constants ─────────────────────────────────────────────────────────────────
const R_NM  = 3440.065;
const toRad = d => d * Math.PI / 180;
const toDeg = r => r * 180 / Math.PI;

// ── GPX Parser ────────────────────────────────────────────────────────────────
export function parseGpx(xmlText) {
    const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
    if (doc.querySelector('parsererror'))
        throw new Error('Invalid GPX file — XML parse error.');

    // Namespace-agnostic: match on localName so namespace-prefixed files work too
    const byTag = (parent, name) =>
        [...parent.querySelectorAll('*')].filter(el => el.localName === name);

    const ptToObj = (el, idx) => ({
        name: byTag(el, 'name')[0]?.textContent?.trim() ||
              `PT${String(idx + 1).padStart(3, '0')}`,
        lat:  parseFloat(el.getAttribute('lat')),
        lon:  parseFloat(el.getAttribute('lon')),
        ele:  parseFloat(byTag(el, 'ele')[0]?.textContent ?? '0'),
    });

    // Route takes priority over track
    const rtepts = byTag(doc, 'rtept');
    if (rtepts.length >= 2)
        return rtepts.map(ptToObj);

    const trk = byTag(doc, 'trk')[0];
    if (!trk) throw new Error('No <rte> or <trk> found in GPX.');
    const seg = byTag(trk, 'trkseg')[0];
    if (!seg) throw new Error('No <trkseg> found in GPX track.');
    const pts = byTag(seg, 'trkpt').map(ptToObj);
    if (pts.length < 2) throw new Error('Need at least 2 track points.');
    return pts;
}

// ── Geodesic math ─────────────────────────────────────────────────────────────
export function trueCourse(lat1, lon1, lat2, lon2) {
    const dLon = toRad(lon2 - lon1);
    const y = Math.sin(dLon) * Math.cos(toRad(lat2));
    const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2))
            - Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon);
    return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

export function distanceNm(lat1, lon1, lat2, lon2) {
    const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2
            + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return R_NM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── Wind math — identical to flight_planner.py template formulas ──────────────
export function computeWca(windDir, windSpeed, mc, tas) {
    const angle = toRad(windDir - 180 - mc);
    return -(windSpeed * 60 * Math.sin(angle)) / tas;
}

export function computeGs(windDir, windSpeed, mc, tas, wcaDeg) {
    const angle = toRad(windDir - 180 - mc);
    return tas * Math.cos(toRad(wcaDeg)) + windSpeed * Math.cos(angle);
}

// ── Leg computation ───────────────────────────────────────────────────────────
export function computeLegs(points, windDir, windSpeed, tas, fuelGph, declination) {
    const negDecl = -declination;
    return points.slice(1).map((p2, i) => {
        const p1   = points[i];
        const tc   = trueCourse(p1.lat, p1.lon, p2.lat, p2.lon);
        const dist = distanceNm(p1.lat, p1.lon, p2.lat, p2.lon);
        const mc   = ((tc + negDecl) % 360 + 360) % 360;
        const wca  = computeWca(windDir, windSpeed, mc, tas);
        const mh   = ((mc + wca) % 360 + 360) % 360;
        const gs   = computeGs(windDir, windSpeed, mc, tas, wca);
        const eteH = gs > 0 ? dist / gs : NaN;
        const fuel = isFinite(eteH) ? eteH * fuelGph : NaN;
        return { from: p1.name, to: p2.name, tc, negDecl, mc, wca, mh, dist, gs, eteH, fuel };
    });
}

// ── Formatting ────────────────────────────────────────────────────────────────
export function fmtTime(h) {
    if (!isFinite(h) || h <= 0) return '—';
    const totalSec = Math.round(h * 3600);
    const hh = Math.floor(totalSec / 3600);
    const mm = Math.floor((totalSec % 3600) / 60);
    const ss = totalSec % 60;
    if (hh > 0)
        return `${hh}h${String(mm).padStart(2, '0')}m${String(ss).padStart(2, '0')}s`;
    return `${mm}m${String(ss).padStart(2, '0')}s`;
}

export const r0 = v => String(Math.round(v));
export const r1 = v => (Math.round(v * 10) / 10).toFixed(1);
export const r2 = v => (Math.round(v * 100) / 100).toFixed(2);
