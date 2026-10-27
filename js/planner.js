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

// ── VOR lookup ────────────────────────────────────────────────────────────────
export function findNearestVor(lat, lon, vors, cruiseAltFt, declination) {
    let best = null;
    let bestDist = Infinity;
    for (const vor of vors) {
        const vorElevFt = isFinite(vor.elevFt) && vor.elevFt >= 0 ? vor.elevFt : 0;
        const losNm = 1.23 * (Math.sqrt(Math.max(0, cruiseAltFt)) + Math.sqrt(vorElevFt));
        const dme = distanceNm(lat, lon, vor.lat, vor.lon);
        if (dme <= losNm && dme < bestDist) {
            bestDist = dme;
            const tc     = trueCourse(vor.lat, vor.lon, lat, lon);
            const radial = ((tc - declination) % 360 + 360) % 360;
            best = { ident: vor.ident, freq: vor.freq, dme, radial };
        }
    }
    return best;
}
export function computeFuelSummary({ tripFuel, taxiFuel, climbFuel, fuelGph, reserveMin, alternateFuel = 0, tgCount = 0, tgCircuitMin = 6 }) {
    const safe = v => (isFinite(v) && v >= 0 ? v : 0);
    const trip      = safe(tripFuel);
    const taxi      = safe(taxiFuel);
    const climb     = safe(climbFuel);
    const gph       = safe(fuelGph);
    const resMins   = safe(reserveMin);
    const altFuel   = safe(alternateFuel);
    const tgN       = safe(tgCount);
    const tgMin     = safe(tgCircuitMin) || 6;
    const tgFuel       = tgN * (gph * tgMin / 60 + climb);
    const climbTotal   = climb * 2;
    const expectedBurn = trip + taxi + climb + tgFuel;
    const holdingFuel  = gph * 10 / 60;
    const reserveFuel  = gph * resMins / 60;
    const total        = trip + taxi + climbTotal + tgFuel + holdingFuel + reserveFuel + altFuel;
    return { tripFuel: trip, taxiFuel: taxi, climbFuel: climb, climbTotal, tgFuel, tgCount: tgN, tgCircuitMin: tgMin, expectedBurn, holdingFuel, reserveFuel, reserveMin: resMins, alternateFuel: altFuel, total };
}

// ── Airspace (PANSA AUP/UUP + static airspace GeoJSON) ────────────────────────
// Altitude limits come as "GND", "UNL", "A061" (6100 ft AMSL) or "F095" (FL95).
// Flight levels are converted at standard pressure (FL × 100 ft).
export function parseAltitudeLimit(s) {
    const v = String(s ?? '').trim().toUpperCase();
    if (v === 'GND' || v === 'SFC') return 0;
    if (v === 'UNL') return Infinity;
    const m = /^([AF])(\d{2,3})$/.exec(v);
    return m ? parseInt(m[2], 10) * 100 : NaN;
}

function pointInRing([x, y], ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i], [xj, yj] = ring[j];
        if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi)
            inside = !inside;
    }
    return inside;
}

const EPS = 1e-9;

function pointOnSegment([x, y], [x1, y1], [x2, y2]) {
    const cross = (x2 - x1) * (y - y1) - (y2 - y1) * (x - x1);
    if (Math.abs(cross) > EPS * Math.hypot(x2 - x1, y2 - y1)) return false;
    return x >= Math.min(x1, x2) - EPS && x <= Math.max(x1, x2) + EPS
        && y >= Math.min(y1, y2) - EPS && y <= Math.max(y1, y2) + EPS;
}

const pointOnRing = (pt, ring) => ring.some((p, i) => i > 0 && pointOnSegment(pt, ring[i - 1], p));

// rings: GeoJSON Polygon coordinates — [outer, ...holes], each ring [[lon, lat], ...]
// A point on any boundary (outer or hole) counts as inside — flying along an
// airspace boundary is reported, not treated as clear.
export function pointInPolygon(pt, rings) {
    if (rings.some(r => pointOnRing(pt, r))) return true;
    return pointInRing(pt, rings[0]) && !rings.slice(1).some(h => pointInRing(pt, h));
}

// Parameters t ∈ [0,1] along a→b where it meets c→d; for collinear overlap,
// where c and d project onto a→b
function segmentIntersectTs(a, b, c, d) {
    const rx = b[0] - a[0], ry = b[1] - a[1];
    const sx = d[0] - c[0], sy = d[1] - c[1];
    const qx = c[0] - a[0], qy = c[1] - a[1];
    const rLen = Math.hypot(rx, ry);
    const den = rx * sy - ry * sx;
    if (Math.abs(den) <= EPS * rLen * Math.hypot(sx, sy)) {
        if (rLen === 0 || Math.abs(qx * ry - qy * rx) > EPS * rLen) return [];
        return [c, d].map(p => ((p[0] - a[0]) * rx + (p[1] - a[1]) * ry) / (rLen * rLen))
                     .filter(t => t >= 0 && t <= 1);
    }
    const t = (qx * sy - qy * sx) / den;
    const u = (qx * ry - qy * rx) / den;
    return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? [t] : [];
}

// Portions of segment a→b inside the polygon, or within bufferNm of it, as
// [[t0, t1], ...] with t ∈ [0,1]. A segment that only touches the boundary (or
// the edge of the buffer) gets a zero-length [t, t] contact. Planar in lon/lat —
// fine for VFR leg lengths.
export function segmentPolygonIntervals(a, b, rings, bufferNm = 0) {
    if (bufferNm > 0) return bufferedIntervals(a, b, rings, bufferNm);
    const ts = [0, 1];
    for (const ring of rings)
        for (let i = 0; i < ring.length - 1; i++)
            ts.push(...segmentIntersectTs(a, b, ring[i], ring[i + 1]));
    ts.sort((x, y) => x - y);
    const at = t => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    const intervals = [];
    for (let i = 0; i < ts.length - 1; i++) {
        const t0 = ts[i], t1 = ts[i + 1];
        if (t1 - t0 < 1e-9) continue;
        if (!pointInPolygon(at((t0 + t1) / 2), rings)) continue;
        const last = intervals[intervals.length - 1];
        if (last && t0 - last[1] < 1e-9) last[1] = t1;
        else intervals.push([t0, t1]);
    }
    for (const t of ts) {
        if (intervals.some(([t0, t1]) => t >= t0 - 1e-9 && t <= t1 + 1e-9)) continue;
        if (pointInPolygon(at(t), rings)) intervals.push([t, t]);
    }
    return intervals.sort((x, y) => x[0] - y[0]);
}

// Flat projection to NM around a reference latitude; linear, so t along a
// segment and inside/outside are the same as in lon/lat
const nmProjection = lat0 => {
    const k = 60 * Math.cos(toRad(lat0));
    return ([lon, lat]) => [lon * k, lat * 60];
};

function pointSegmentDist([px, py], [ax, ay], [bx, by]) {
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
    return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}

function pointPolygonDist(p, rings) {
    if (pointInPolygon(p, rings)) return 0;
    let d = Infinity;
    for (const ring of rings)
        for (let i = 1; i < ring.length; i++) d = Math.min(d, pointSegmentDist(p, ring[i - 1], ring[i]));
    return d;
}

// Points along a→b (projected) where the distance to the polygon can be
// smallest: the ends, the boundary crossings, and every vertex's foot point
function closestCandidates(a, b, rings) {
    const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
    const ts = [0, 1];
    for (const ring of rings)
        for (let i = 0; i < ring.length - 1; i++) {
            ts.push(...segmentIntersectTs(a, b, ring[i], ring[i + 1]));
            if (l2) ts.push(Math.max(0, Math.min(1, ((ring[i][0] - a[0]) * dx + (ring[i][1] - a[1]) * dy) / l2)));
        }
    return ts;
}

const SAMPLE_NM = 0.1;

function bufferedIntervals(a, b, rings, bufferNm) {
    const proj = nmProjection((a[1] + b[1]) / 2);
    const A = proj(a), B = proj(b), R = rings.map(r => r.map(proj));
    const at = t => [A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t];
    const within = t => pointPolygonDist(at(t), R) <= bufferNm;
    // Boundary of the within-buffer stretch between an inside and an outside t
    const edge = (tIn, tOut) => {
        for (let i = 0; i < 40; i++) { const m = (tIn + tOut) / 2; if (within(m)) tIn = m; else tOut = m; }
        return tIn;
    };
    const n = Math.max(1, Math.ceil(Math.hypot(B[0] - A[0], B[1] - A[1]) / SAMPLE_NM));
    const intervals = [];
    let start = within(0) ? 0 : null;
    for (let i = 1; i <= n; i++) {
        const t0 = (i - 1) / n, t1 = i / n, inside = within(t1);
        if (inside && start === null) start = edge(t1, t0);
        if (!inside && start !== null) { intervals.push([start, edge(t0, t1)]); start = null; }
    }
    if (start !== null) intervals.push([start, 1]);
    // An approach narrower than the sampling step: grow it from the closest point
    for (const t of closestCandidates(A, B, R)) {
        if (!within(t) || intervals.some(([s, e]) => t >= s - 1e-9 && t <= e + 1e-9)) continue;
        const k = Math.floor(t * n);
        intervals.push([edge(t, k / n), edge(t, Math.min(1, (k + 1) / n))]);
    }
    intervals.sort((x, y) => x[0] - y[0]);
    return intervals.reduce((out, iv) => {
        const last = out[out.length - 1];
        if (last && iv[0] - last[1] < 1e-9) last[1] = Math.max(last[1], iv[1]);
        else out.push(iv);
        return out;
    }, []);
}

// Closest approach of segment a→b to the polygon, in NM
function segmentPolygonDistanceNm(a, b, rings) {
    const proj = nmProjection((a[1] + b[1]) / 2);
    const A = proj(a), B = proj(b), R = rings.map(r => r.map(proj));
    return Math.min(...closestCandidates(A, B, R).map(t =>
        pointPolygonDist([A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t], R)));
}

function polygonsOf(geometry) {
    if (geometry?.type === 'Polygon') return [geometry.coordinates];
    if (geometry?.type === 'MultiPolygon') return geometry.coordinates;
    return [];
}

function bboxOf(polygons) {
    const b = [Infinity, Infinity, -Infinity, -Infinity];
    for (const rings of polygons)
        for (const [x, y] of rings[0]) {
            b[0] = Math.min(b[0], x); b[1] = Math.min(b[1], y);
            b[2] = Math.max(b[2], x); b[3] = Math.max(b[3], y);
        }
    return b;
}

const limits = (lower, upper) => ({
    lower, upper, lowerFt: parseAltitudeLimit(lower), upperFt: parseAltitudeLimit(upper),
});

// The static layer holds a copy of every area per AIRAC cycle (startTime–endTime),
// typically the cycle in force and the next one. Keep the cycle(s) in force at
// any point of the flight [from, to]; if none covers it (cycle not yet
// published), fall back to the latest cycle with covered = false.
export function staticAirspaceInForce(features, from, to) {
    const t0 = from.getTime(), t1 = to.getTime();
    const inForce = features.filter(f => {
        const s = Date.parse(f.properties.startTime), e = Date.parse(f.properties.endTime);
        return !(s > t1) && !(e <= t0);   // missing dates (NaN) keep the feature
    });
    const dated = inForce.filter(f => !isNaN(Date.parse(f.properties.startTime)));
    if (dated.length || !features.some(f => !isNaN(Date.parse(f.properties.startTime))))
        return { features: inForce, covered: true };
    const latest = Math.max(...features.map(f => Date.parse(f.properties.startTime)).filter(isFinite));
    return {
        features: features.filter(f => isNaN(Date.parse(f.properties.startTime)) || Date.parse(f.properties.startTime) === latest),
        covered: false,
    };
}

// Normalises PANSA GeoJSON layers into one list of airspaces.
// Reservation layers (AUP, UUP, next-day AUP) — each { source, features } or a
// bare feature array — are merged per area and their reservations unioned, so an
// area reserved in any of them is reported; each reservation lists its sources.
export function buildAirspaces(staticFeatures = [], reservationLayers = []) {
    const out = [];
    const seen = new Set();
    for (const f of staticFeatures) {
        const polygons = polygonsOf(f.geometry);
        if (!polygons.length) continue;
        const p = f.properties;
        // A flight spanning an AIRAC changeover gets both cycles; drop unchanged repeats
        const key = [p.designator, p.lowerAltitude, p.upperAltitude, JSON.stringify(polygons)].join('|');
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({
            kind: 'static', designator: p.designator, type: p.airspaceElementType,
            ...limits(p.lowerAltitude, p.upperAltitude),
            services: p.services ?? [], polygons, bbox: bboxOf(polygons),
        });
    }
    const byKey = new Map();
    for (const layer of reservationLayers) {
        const { source = null, features } = Array.isArray(layer) ? { features: layer } : layer;
        for (const f of features) {
            const polygons = polygonsOf(f.geometry);
            if (!polygons.length) continue;
            const key = f.properties.designator + '|' + JSON.stringify(polygons);
            let as = byKey.get(key);
            if (!as) {
                as = { kind: 'reserved', designator: f.properties.designator, type: f.properties.airspaceElementType,
                       reservations: [], polygons, bbox: bboxOf(polygons) };
                byKey.set(key, as);
                out.push(as);
            }
            for (const r of f.properties.airspaceReservations ?? []) {
                const res = {
                    start: Date.parse(r.startDate), end: Date.parse(r.endDate),
                    ...limits(r.lowerAltitude, r.upperAltitude),
                    unit: r.unit ?? '', remarks: r.remarks ?? '', status: r.reservationStatus ?? '',
                    sources: source ? [source] : [],
                };
                const same = as.reservations.find(x => x.start === res.start && x.end === res.end
                                                    && x.lower === res.lower && x.upper === res.upper);
                if (!same) { as.reservations.push(res); continue; }
                if (source && !same.sources.includes(source)) same.sources.push(source);
                // Later layers (UUP after AUP) carry the newer unit and remarks,
                // including an explicitly emptied one
                if (r.unit !== undefined) same.unit = res.unit;
                if (r.remarks !== undefined) same.remarks = res.remarks;
                if (res.status === 'ACTIVATED') same.status = 'ACTIVATED';
            }
        }
    }
    for (const as of out) as.reservations?.sort((x, y) => x.start - y.start);
    return out;
}

const STATIC_STATUS = { P: 'prohibited', R: 'restricted', ADIZ: 'adiz' };

// Finds where the route enters each airspace — or comes within bufferNm of it —
// and checks it against the cruise altitude and (if a departure time is given)
// the time the aircraft is inside or within the buffer. distanceNm is the
// closest approach (0 when the route enters the airspace).
// Vertically, airspace (or a reservation) is reported unless its lower limit is
// more than verticalBufferFt above cruise; everything below cruise is kept and
// flagged belowCruise. Missing altitude or timing is treated as a possible
// conflict, never as clear. With reservationsReliable = false (flight
// outside the published AUP, or stale data) a reserved area with no matching
// reservation is 'unverified' rather than 'inactive'.
export function findAirspaceCrossings(points, legs, airspaces, { cruiseAltFt = 0, departure = null, reservationsReliable = true, bufferNm = 0, verticalBufferFt = 0 } = {}) {
    const raw = [];
    let cumNm = 0, cumH = 0;
    legs.forEach((leg, i) => {
        const a = [points[i].lon, points[i].lat], b = [points[i + 1].lon, points[i + 1].lat];
        // Leg bounding box grown by the buffer (in degrees, at the leg's highest latitude)
        const padLat = bufferNm / 60;
        const padLon = bufferNm / (60 * Math.cos(toRad(Math.min(89, Math.max(Math.abs(a[1]), Math.abs(b[1])) + padLat))));
        const lb = [Math.min(a[0], b[0]) - padLon, Math.min(a[1], b[1]) - padLat,
                    Math.max(a[0], b[0]) + padLon, Math.max(a[1], b[1]) + padLat];
        const eteH = isFinite(leg.eteH) ? leg.eteH : NaN;
        for (const as of airspaces) {
            if (as.bbox[0] > lb[2] || as.bbox[2] < lb[0] || as.bbox[1] > lb[3] || as.bbox[3] < lb[1]) continue;
            for (const rings of as.polygons) {
                const intervals = segmentPolygonIntervals(a, b, rings, bufferNm);
                if (!intervals.length) continue;
                const distanceNm = bufferNm > 0 ? segmentPolygonDistanceNm(a, b, rings) : 0;
                for (const [t0, t1] of intervals)
                    raw.push({ as, enterLeg: i, exitLeg: i, distanceNm,
                               enterNm: cumNm + t0 * leg.dist, exitNm: cumNm + t1 * leg.dist,
                               enterH: cumH + t0 * eteH, exitH: cumH + t1 * eteH });
            }
        }
        cumNm += leg.dist;
        cumH += eteH;
    });

    // Join overlapping or adjacent pieces of the same airspace (across a waypoint,
    // or several polygons of one MultiPolygon); a piece only ever extends the exit
    raw.sort((x, y) => x.enterNm - y.enterNm);
    const merged = [];
    for (const c of raw) {
        const prev = merged.findLast(m => m.as === c.as);
        if (prev && c.enterNm - prev.exitNm < 1e-6) {
            if (c.exitNm > prev.exitNm) { prev.exitNm = c.exitNm; prev.exitH = c.exitH; prev.exitLeg = c.exitLeg; }
            prev.distanceNm = Math.min(prev.distanceNm, c.distanceNm);
        } else merged.push({ ...c });
    }

    const cruise = cruiseAltFt > 0 ? cruiseAltFt : null;
    const depMs = departure instanceof Date && !isNaN(departure) ? departure.getTime() : null;

    const relevantAlt = lo => cruise === null || isNaN(lo) || lo <= cruise + verticalBufferFt;
    const below = hi => cruise !== null && hi < cruise;

    const result = [];
    for (const c of merged) {
        const enterTime = depMs !== null && isFinite(c.enterH) ? new Date(depMs + c.enterH * 3600e3) : null;
        const exitTime  = depMs !== null && isFinite(c.exitH)  ? new Date(depMs + c.exitH  * 3600e3) : null;
        const timeHit = (s, e) => {
            if (!enterTime || !exitTime) return true;
            const t0 = enterTime.getTime(), t1 = exitTime.getTime();
            // A point contact counts if the reservation is in force at that instant
            return t0 === t1 ? s <= t0 && e >= t0 : s < t1 && e > t0;
        };
        const base = { designator: c.as.designator, type: c.as.type, enterLeg: c.enterLeg, exitLeg: c.exitLeg,
                       enterNm: c.enterNm, exitNm: c.exitNm, enterTime, exitTime,
                       distanceNm: c.distanceNm < 1e-6 ? 0 : c.distanceNm };
        if (c.as.kind === 'static') {
            if (!relevantAlt(c.as.lowerFt)) continue;
            result.push({ ...base, status: STATIC_STATUS[c.as.type] ?? 'controlled', belowCruise: below(c.as.upperFt),
                          lower: c.as.lower, upper: c.as.upper, services: c.as.services, reservations: [] });
        } else {
            const inBand = c.as.reservations.filter(r => relevantAlt(r.lowerFt));
            if (!inBand.length) continue;
            const active = inBand.filter(r => timeHit(r.start, r.end));
            const shown = active.length ? active : inBand;
            result.push({ ...base, status: active.length ? 'active' : reservationsReliable ? 'inactive' : 'unverified',
                          belowCruise: shown.every(r => below(r.upperFt)), reservations: shown, services: [] });
        }
    }
    return result;
}
