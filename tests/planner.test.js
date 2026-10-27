import { describe, it, expect, beforeEach } from 'vitest';
import {
    parseGpx, trueCourse, distanceNm,
    computeWca, computeGs, computeLegs,
    computeFuelSummary, findNearestVor,
    fmtTime, r0, r1, r2,
    parseAltitudeLimit, pointInPolygon, segmentPolygonIntervals,
    buildAirspaces, findAirspaceCrossings, airacCycles, staticAirspaceForCycle, cycleInForce, crossingsByLeg,
} from '../js/planner.js';

// ── GPX fixtures ──────────────────────────────────────────────────────────────
const rteGpx = (pts) =>
    `<?xml version="1.0" encoding="utf-8"?>
<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">
  <rte>
    ${pts.map(p => `<rtept lat="${p.lat}" lon="${p.lon}">${p.name ? `<name>${p.name}</name>` : ''}<ele>${p.ele ?? 0}</ele></rtept>`).join('\n    ')}
  </rte>
</gpx>`;

const trkGpx = (pts) =>
    `<?xml version="1.0" encoding="utf-8"?>
<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <trkseg>
      ${pts.map(p => `<trkpt lat="${p.lat}" lon="${p.lon}">${p.name ? `<name>${p.name}</name>` : ''}</trkpt>`).join('\n      ')}
    </trkseg>
  </trk>
</gpx>`;

const TWO_PTS = [
    { lat: 52.0, lon: 21.0, name: 'EPMO' },
    { lat: 52.5, lon: 21.0, name: 'EPWA' },
];

// ── parseGpx ──────────────────────────────────────────────────────────────────
describe('parseGpx', () => {
    it('parses route points with names and coordinates', () => {
        const pts = parseGpx(rteGpx(TWO_PTS));
        expect(pts).toHaveLength(2);
        expect(pts[0].name).toBe('EPMO');
        expect(pts[0].lat).toBeCloseTo(52.0);
        expect(pts[0].lon).toBeCloseTo(21.0);
    });

    it('parses track points from trk/trkseg/trkpt', () => {
        const pts = parseGpx(trkGpx(TWO_PTS));
        expect(pts).toHaveLength(2);
        expect(pts[1].name).toBe('EPWA');
    });

    it('prefers route over track when both are present', () => {
        const gpx = `<?xml version="1.0" encoding="utf-8"?>
<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">
  <rte>
    <rtept lat="1.0" lon="1.0"><name>RTE_A</name></rtept>
    <rtept lat="2.0" lon="2.0"><name>RTE_B</name></rtept>
  </rte>
  <trk><trkseg>
    <trkpt lat="3.0" lon="3.0"><name>TRK_A</name></trkpt>
    <trkpt lat="4.0" lon="4.0"><name>TRK_B</name></trkpt>
  </trkseg></trk>
</gpx>`;
        const pts = parseGpx(gpx);
        expect(pts[0].name).toBe('RTE_A');
    });

    it('generates fallback names PT001, PT002 when name element is absent', () => {
        const pts = parseGpx(rteGpx([
            { lat: 52.0, lon: 21.0 },
            { lat: 52.5, lon: 21.0 },
        ]));
        expect(pts[0].name).toBe('PT001');
        expect(pts[1].name).toBe('PT002');
    });

    it('throws on fewer than 2 route points', () => {
        const gpx = `<?xml version="1.0" encoding="utf-8"?>
<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">
  <rte><rtept lat="52.0" lon="21.0"><name>A</name></rtept></rte>
</gpx>`;
        expect(() => parseGpx(gpx)).toThrow();
    });

    it('throws on fewer than 2 track points', () => {
        const gpx = `<?xml version="1.0" encoding="utf-8"?>
<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">
  <trk><trkseg><trkpt lat="52.0" lon="21.0"/></trkseg></trk>
</gpx>`;
        expect(() => parseGpx(gpx)).toThrow();
    });

    it('throws on invalid XML', () => {
        expect(() => parseGpx('<not valid xml<<')).toThrow('XML parse error');
    });

    it('handles namespace-prefixed GPX (localName matching)', () => {
        const gpx = `<?xml version="1.0" encoding="utf-8"?>
<gpx:gpx version="1.1" xmlns:gpx="http://www.topografix.com/GPX/1/1">
  <gpx:rte>
    <gpx:rtept lat="52.0" lon="21.0"><gpx:name>A</gpx:name></gpx:rtept>
    <gpx:rtept lat="53.0" lon="21.0"><gpx:name>B</gpx:name></gpx:rtept>
  </gpx:rte>
</gpx:gpx>`;
        const pts = parseGpx(gpx);
        expect(pts).toHaveLength(2);
        expect(pts[0].name).toBe('A');
    });
});

// ── trueCourse ────────────────────────────────────────────────────────────────
describe('trueCourse', () => {
    it('due east is ~90°', () => {
        expect(trueCourse(0, 0, 0, 1)).toBeCloseTo(90, 0);
    });

    it('due west is ~270°', () => {
        expect(trueCourse(0, 0, 0, -1)).toBeCloseTo(270, 0);
    });

    it('due north is ~0/360°', () => {
        const tc = trueCourse(0, 0, 1, 0);
        expect(tc < 1 || tc > 359).toBe(true);
    });

    it('due south is ~180°', () => {
        expect(trueCourse(0, 0, -1, 0)).toBeCloseTo(180, 0);
    });

    it('northeast is between 0° and 90°', () => {
        const tc = trueCourse(0, 0, 1, 1);
        expect(tc).toBeGreaterThan(0);
        expect(tc).toBeLessThan(90);
    });
});

// ── distanceNm ────────────────────────────────────────────────────────────────
describe('distanceNm', () => {
    it('1° of latitude is approximately 60 NM', () => {
        expect(distanceNm(0, 0, 1, 0)).toBeCloseTo(60, 0);
    });

    it('same point returns 0', () => {
        expect(distanceNm(52.0, 21.0, 52.0, 21.0)).toBe(0);
    });

    it('is symmetric (A→B equals B→A)', () => {
        expect(distanceNm(52.0, 21.0, 52.5, 21.5))
            .toBeCloseTo(distanceNm(52.5, 21.5, 52.0, 21.0), 6);
    });
});

// ── computeWca ────────────────────────────────────────────────────────────────
describe('computeWca', () => {
    it('zero wind gives zero WCA', () => {
        expect(computeWca(270, 0, 90, 100)).toBeCloseTo(0, 10);
    });

    it('direct headwind gives zero WCA', () => {
        // Wind from east (90°), heading east (MC=90°) → headwind
        expect(computeWca(90, 20, 90, 100)).toBeCloseTo(0, 5);
    });

    it('direct tailwind gives zero WCA', () => {
        // Wind from west (270°), heading east (MC=90°) → tailwind
        expect(computeWca(270, 20, 90, 100)).toBeCloseTo(0, 5);
    });

    it('wind from north, heading east → WCA is negative (correct left)', () => {
        // Wind FROM north pushes aircraft south → correct by heading north → WCA < 0
        expect(computeWca(0, 20, 90, 100)).toBeLessThan(0);
    });

    it('wind from south, heading east → WCA is positive (correct right)', () => {
        expect(computeWca(180, 20, 90, 100)).toBeGreaterThan(0);
    });
});

// ── computeGs ─────────────────────────────────────────────────────────────────
describe('computeGs', () => {
    it('zero wind → GS equals TAS', () => {
        expect(computeGs(0, 0, 90, 100, 0)).toBeCloseTo(100, 5);
    });

    it('direct tailwind increases GS above TAS', () => {
        // Wind from west (270°), heading east (MC=90°)
        expect(computeGs(270, 20, 90, 100, 0)).toBeCloseTo(120, 0);
    });

    it('direct headwind decreases GS below TAS', () => {
        // Wind from east (90°), heading east (MC=90°)
        expect(computeGs(90, 20, 90, 100, 0)).toBeCloseTo(80, 0);
    });
});

// ── computeLegs ───────────────────────────────────────────────────────────────
describe('computeLegs', () => {
    const POINTS = [
        { name: 'A', lat: 52.0, lon: 21.0, ele: 100 },
        { name: 'B', lat: 52.3, lon: 21.3, ele: 100 },
        { name: 'C', lat: 52.6, lon: 21.0, ele: 100 },
    ];

    it('N points produce N-1 legs', () => {
        expect(computeLegs(POINTS, 0, 0, 100, 6, 0)).toHaveLength(2);
    });

    it('leg has all expected fields', () => {
        const [leg] = computeLegs(POINTS, 0, 0, 100, 6, 0);
        for (const field of ['from', 'to', 'tc', 'negDecl', 'mc', 'wca', 'mh', 'dist', 'gs', 'eteH', 'fuel']) {
            expect(leg).toHaveProperty(field);
        }
    });

    it('from/to names match input points', () => {
        const legs = computeLegs(POINTS, 0, 0, 100, 6, 0);
        expect(legs[0].from).toBe('A');
        expect(legs[0].to).toBe('B');
        expect(legs[1].from).toBe('B');
        expect(legs[1].to).toBe('C');
    });

    it('distance is positive', () => {
        computeLegs(POINTS, 0, 0, 100, 6, 0).forEach(l => expect(l.dist).toBeGreaterThan(0));
    });

    it('GS is positive for calm wind', () => {
        computeLegs(POINTS, 0, 0, 100, 6, 0).forEach(l => expect(l.gs).toBeGreaterThan(0));
    });

    it('ETE equals dist/GS when GS > 0', () => {
        computeLegs(POINTS, 0, 0, 100, 6, 0).forEach(l => {
            expect(l.eteH).toBeCloseTo(l.dist / l.gs, 5);
        });
    });

    it('extreme headwind produces NaN eteH and fuel', () => {
        // Wind from east (90°), heading east (MC≈90°), windSpeed >> TAS
        const [leg] = computeLegs(
            [{ name: 'A', lat: 0, lon: 0, ele: 0 }, { name: 'B', lat: 0, lon: 1, ele: 0 }],
            90, 200, 100, 6, 0,
        );
        expect(leg.gs).toBeLessThanOrEqual(0);
        expect(Number.isNaN(leg.eteH)).toBe(true);
        expect(Number.isNaN(leg.fuel)).toBe(true);
    });

    it('applies declination: MC = (TC − decl) for easterly declination', () => {
        const [leg] = computeLegs(
            [{ name: 'A', lat: 0, lon: 0, ele: 0 }, { name: 'B', lat: 0, lon: 1, ele: 0 }],
            0, 0, 100, 6, 5, // 5° East declination
        );
        // TC ≈ 90°, negDecl = -5°, MC ≈ 85°
        expect(leg.mc).toBeCloseTo(85, 0);
    });
});

// ── fmtTime ───────────────────────────────────────────────────────────────────
describe('fmtTime', () => {
    it('0.5h → "30m00s"', () => expect(fmtTime(0.5)).toBe('30m00s'));
    it('1.0h → "1h00m00s"', () => expect(fmtTime(1.0)).toBe('1h00m00s'));
    it('1.5h → "1h30m00s"', () => expect(fmtTime(1.5)).toBe('1h30m00s'));
    it('2.0h → "2h00m00s"', () => expect(fmtTime(2.0)).toBe('2h00m00s'));
    it('25 minutes 30 seconds → "25m30s"', () => expect(fmtTime(25.5 / 60)).toBe('25m30s'));
    it('0 → "—"', () => expect(fmtTime(0)).toBe('—'));
    it('negative → "—"', () => expect(fmtTime(-1)).toBe('—'));
    it('NaN → "—"', () => expect(fmtTime(NaN)).toBe('—'));
});

// ── computeFuelSummary ────────────────────────────────────────────────────────
describe('computeFuelSummary', () => {
    it('sums all components correctly', () => {
        const s = computeFuelSummary({ tripFuel: 10, taxiFuel: 1.5, climbFuel: 2, fuelGph: 6, reserveMin: 45 });
        expect(s.tripFuel).toBeCloseTo(10);
        expect(s.taxiFuel).toBeCloseTo(1.5);
        expect(s.climbTotal).toBeCloseTo(4);      // 2 × 2
        expect(s.expectedBurn).toBeCloseTo(13.5); // trip(10) + taxi(1.5) + climb(2)
        expect(s.tgFuel).toBeCloseTo(0);          // no T&Gs
        expect(s.holdingFuel).toBeCloseTo(1);     // 6 × 10/60
        expect(s.reserveFuel).toBeCloseTo(4.5);   // 6 × 45/60
        expect(s.total).toBeCloseTo(21);          // 10 + 1.5 + 4 + 1 + 4.5
    });

    it('uses 60-min reserve correctly', () => {
        const s = computeFuelSummary({ tripFuel: 0, taxiFuel: 0, climbFuel: 0, fuelGph: 6, reserveMin: 60 });
        expect(s.reserveFuel).toBeCloseTo(6);
        expect(s.reserveMin).toBe(60);
    });

    it('NaN inputs default to 0', () => {
        const s = computeFuelSummary({ tripFuel: NaN, taxiFuel: NaN, climbFuel: NaN, fuelGph: NaN, reserveMin: NaN });
        expect(s.total).toBe(0);
    });

    it('negative inputs default to 0', () => {
        const s = computeFuelSummary({ tripFuel: -5, taxiFuel: -1, climbFuel: -2, fuelGph: 6, reserveMin: 45 });
        expect(s.tripFuel).toBe(0);
        expect(s.taxiFuel).toBe(0);
        expect(s.climbTotal).toBe(0);
        expect(s.reserveFuel).toBeCloseTo(4.5);
    });

    it('T&G fuel included in expectedBurn and total', () => {
        // 2 T&Gs, 6 min circuits, fuelGph=6, climbFuel=1
        // tgFuel = 2 × (6×6/60 + 1) = 2 × (0.6 + 1) = 3.2
        const s = computeFuelSummary({ tripFuel: 5, taxiFuel: 0, climbFuel: 1, fuelGph: 6, reserveMin: 45, tgCount: 2, tgCircuitMin: 6 });
        expect(s.tgFuel).toBeCloseTo(3.2);
        expect(s.expectedBurn).toBeCloseTo(5 + 0 + 1 + 3.2); // trip + taxi + climb + tg
    });

    it('zero T&Gs produces no tgFuel', () => {
        const s = computeFuelSummary({ tripFuel: 5, taxiFuel: 0, climbFuel: 1, fuelGph: 6, reserveMin: 45, tgCount: 0 });
        expect(s.tgFuel).toBe(0);
    });


    it('alternateFuel is included in total', () => {
        const s = computeFuelSummary({ tripFuel: 10, taxiFuel: 0, climbFuel: 0, fuelGph: 6, reserveMin: 45, alternateFuel: 3 });
        expect(s.alternateFuel).toBeCloseTo(3);
        expect(s.total).toBeCloseTo(3 + 10 + 1 + 4.5); // alt + trip + holding + reserve
    });

    it('alternateFuel defaults to 0 when omitted', () => {
        const s = computeFuelSummary({ tripFuel: 5, taxiFuel: 0, climbFuel: 0, fuelGph: 4, reserveMin: 45 });
        expect(s.alternateFuel).toBe(0);
    });

    it('NaN alternateFuel defaults to 0', () => {
        const s = computeFuelSummary({ tripFuel: 5, taxiFuel: 0, climbFuel: 0, fuelGph: 4, reserveMin: 45, alternateFuel: NaN });
        expect(s.alternateFuel).toBe(0);
    });

    it('zero climb and taxi fuel produce correct total', () => {
        const s = computeFuelSummary({ tripFuel: 8, taxiFuel: 0, climbFuel: 0, fuelGph: 4, reserveMin: 45 });
        expect(s.total).toBeCloseTo(11 + 4 * 10 / 60); // 8 + holding(4gph) + reserve(3)
    });
});


// ── Full pipeline integration ─────────────────────────────────────────────────
// Reference values manually verified against a commercial VFR planning tool.
// GPX coordinates taken from SAMPLE-2026-04-26T19_20_42.gpx.
// Inputs: wind 125°/9kt, TAS 85kt, fuelGph 6, taxiFuel 1.5, climbFuel 2, reserveMin 45.
describe('Full pipeline – EPMO → EPNCA → AEPPL → EPMO', () => {
    const gpx = `<?xml version="1.0" encoding="utf-8"?>
<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">
  <rte>
    <rtept lat="52.451222222" lon="20.651861111"><name>EPMO</name></rtept>
    <rtept lat="52.643058333" lon="20.94165"><name>EPNCA</name></rtept>
    <rtept lat="52.562241667" lon="19.721283333"><name>AEPPL</name></rtept>
    <rtept lat="52.451222222" lon="20.651861111"><name>EPMO</name></rtept>
  </rte>
</gpx>`;

    const WIND_DIR = 125, WIND_SPD = 9, TAS = 85, GPH = 6, DECL = 6.92;
    let legs;
    beforeEach(() => { legs = computeLegs(parseGpx(gpx), WIND_DIR, WIND_SPD, TAS, GPH, DECL); });

    it('produces 3 legs', () => expect(legs).toHaveLength(3));

    it('leg 1 EPMO→EPNCA: TC≈42°, MC≈35°, dist≈15.6NM, GS≈84.4kt', () => {
        const l = legs[0];
        expect(l.from).toBe('EPMO');
        expect(l.to).toBe('EPNCA');
        expect(l.tc).toBeCloseTo(42, 0);
        expect(l.mc).toBeCloseTo(36, 0);
        expect(l.dist).toBeCloseTo(15.6, 0);
        expect(l.gs).toBeCloseTo(84.4, 0);
    });

    it('leg 2 EPNCA→AEPPL: TC≈264°, MC≈257°, dist≈44.8NM, GS≈90.8kt', () => {
        const l = legs[1];
        expect(l.tc).toBeCloseTo(264, 0);
        expect(l.mc).toBeCloseTo(257, 0);
        expect(l.dist).toBeCloseTo(44.8, 0);
        expect(l.gs).toBeCloseTo(90.8, 0);
    });

    it('leg 3 AEPPL→EPMO: TC≈101°, MC≈94°, dist≈34.7NM, GS≈77.2kt', () => {
        const l = legs[2];
        expect(l.tc).toBeCloseTo(101, 0);
        expect(l.mc).toBeCloseTo(94, 0);
        expect(l.dist).toBeCloseTo(34.7, 0);
        expect(l.gs).toBeCloseTo(77.2, 0);
    });

    it('total distance ≈ 95.1 NM, total ETE ≈ 1h 07m 39s', () => {
        const totalNm  = legs.reduce((s, l) => s + l.dist, 0);
        const totalEte = legs.reduce((s, l) => s + l.eteH, 0);
        expect(totalNm).toBeCloseTo(95.1, 0);
        // 1h07m39s = 4059s ≈ 1.1275h
        expect(totalEte * 3600).toBeCloseTo(4059, -1); // within ~10s
    });

    it('fuel summary totals are self-consistent', () => {
        const tripFuel = legs.reduce((s, l) => s + l.fuel, 0);
        const s = computeFuelSummary({ tripFuel, taxiFuel: 1.5, climbFuel: 2, fuelGph: GPH, reserveMin: 45 });
        // expectedBurn = trip + taxi(1.5) + climb(2)
        expect(s.expectedBurn).toBeCloseTo(s.tripFuel + 1.5 + 2, 4);
        // total = trip + taxi + climbTotal(4) + holding + reserve(4.5)
        expect(s.total).toBeCloseTo(s.tripFuel + 1.5 + 4 + s.holdingFuel + 4.5, 4);
        expect(s.total).toBeGreaterThan(s.expectedBurn);
    });
});

// ── findNearestVor ────────────────────────────────────────────────────────────
describe('findNearestVor', () => {
    // VOR at 52.5°N, 21.0°E, elevation 500ft
    const VOR_A = { ident: 'WAR', freq: '114.90', lat: 52.5, lon: 21.0, elevFt: 500 };
    // VOR far away
    const VOR_B = { ident: 'FAR', freq: '115.00', lat: 55.0, lon: 25.0, elevFt: 0 };
    const DECL = 7;

    it('returns nearest VOR within LOS range', () => {
        const result = findNearestVor(52.5, 21.1, [VOR_A, VOR_B], 3500, DECL);
        expect(result).not.toBeNull();
        expect(result.ident).toBe('WAR');
        expect(result.dme).toBeCloseTo(distanceNm(52.5, 21.1, 52.5, 21.0), 3);
    });

    it('returns null when VOR is out of range', () => {
        // Waypoint is very far from VOR — 200 NM away, well beyond LOS
        const result = findNearestVor(54.5, 21.1, [VOR_A], 3500, DECL);
        expect(result).toBeNull();
    });

    it('returns null for empty VOR list', () => {
        expect(findNearestVor(52.5, 21.0, [], 3500, DECL)).toBeNull();
    });

    it('radial is magnetic bearing FROM VOR TO waypoint', () => {
        // Waypoint due east of VOR → TC ≈ 90°, radial ≈ 90 - DECL
        const result = findNearestVor(52.5, 21.5, [VOR_A], 3500, DECL);
        expect(result).not.toBeNull();
        const expectedRadial = ((trueCourse(52.5, 21.0, 52.5, 21.5) - DECL) + 360) % 360;
        expect(result.radial).toBeCloseTo(expectedRadial, 3);
    });

    it('prefers closer VOR when multiple are in range', () => {
        const CLOSE = { ident: 'CLO', freq: '112.00', lat: 52.5, lon: 21.05, elevFt: 0 };
        const result = findNearestVor(52.5, 21.1, [VOR_A, CLOSE], 3500, DECL);
        expect(result.ident).toBe('CLO');
    });

    it('VOR with missing elevation treated as 0ft', () => {
        const vor = { ident: 'NAN', freq: '', lat: 52.5, lon: 21.05, elevFt: NaN };
        const result = findNearestVor(52.5, 21.1, [vor], 3500, DECL);
        expect(result).not.toBeNull(); // still found since NaN → 0
    });
});


describe('r0 / r1 / r2', () => {
    it('r0 rounds to nearest integer as string', () => {
        expect(r0(90.4)).toBe('90');
        expect(r0(90.5)).toBe('91');
        expect(r0(270)).toBe('270');
    });
    it('r1 rounds to 1 decimal place as string', () => {
        expect(r1(1.05)).toBe('1.1');
        expect(r1(270)).toBe('270.0');
    });
    it('r2 rounds to 2 decimal places as string', () => {
        expect(r2(1.456)).toBe('1.46');
        expect(r2(6)).toBe('6.00');
    });
});

// ── Airspace ──────────────────────────────────────────────────────────────────
// Square 1°×1° box between lon 21–22, lat 52–53
const BOX = [[[21, 52], [22, 52], [22, 53], [21, 53], [21, 52]]];
const square = (lon0, lat0, size = 1) =>
    [[[lon0, lat0], [lon0 + size, lat0], [lon0 + size, lat0 + size], [lon0, lat0 + size], [lon0, lat0]]];

const staticFeature = (designator, type, lower, upper, rings = BOX, extra = {}) => ({
    type: 'Feature',
    properties: { designator, airspaceElementType: type, lowerAltitude: lower, upperAltitude: upper, services: [], ...extra },
    geometry: { type: 'Polygon', coordinates: rings },
});
const reservedFeature = (designator, type, reservations, rings = BOX) => ({
    type: 'Feature',
    properties: {
        designator, airspaceElementType: type,
        airspaceReservations: reservations.map(([startDate, endDate, lowerAltitude, upperAltitude, status = 'PLANNED']) =>
            ({ startDate, endDate, lowerAltitude, upperAltitude, unit: 'MIL', remarks: '', reservationStatus: status })),
    },
    geometry: { type: 'Polygon', coordinates: rings },
});

// West→east straight through the middle of BOX, 3 waypoints, legs of 1 h each
const ROUTE = [
    { name: 'A', lat: 52.5, lon: 20.5 },
    { name: 'B', lat: 52.5, lon: 21.5 },
    { name: 'C', lat: 52.5, lon: 22.5 },
];
const ROUTE_LEGS = [{ dist: 40, eteH: 1 }, { dist: 40, eteH: 1 }];

describe('parseAltitudeLimit', () => {
    it('parses GND, UNL, altitudes and flight levels', () => {
        expect(parseAltitudeLimit('GND')).toBe(0);
        expect(parseAltitudeLimit('UNL')).toBe(Infinity);
        expect(parseAltitudeLimit('A061')).toBe(6100);
        expect(parseAltitudeLimit('F095')).toBe(9500);
        expect(parseAltitudeLimit('F660')).toBe(66000);
    });
    it('returns NaN for unknown formats', () => {
        expect(parseAltitudeLimit('1500FT AGL')).toBeNaN();
        expect(parseAltitudeLimit(undefined)).toBeNaN();
    });
});

describe('pointInPolygon', () => {
    it('detects points inside and outside', () => {
        expect(pointInPolygon([21.5, 52.5], BOX)).toBe(true);
        expect(pointInPolygon([20.5, 52.5], BOX)).toBe(false);
    });
    it('excludes holes', () => {
        const withHole = [BOX[0], square(21.25, 52.25, 0.5)[0]];
        expect(pointInPolygon([21.5, 52.5], withHole)).toBe(false);
        expect(pointInPolygon([21.1, 52.1], withHole)).toBe(true);
    });
});

describe('segmentPolygonIntervals', () => {
    it('returns the inside portion of a crossing segment', () => {
        const [iv] = segmentPolygonIntervals([20.5, 52.5], [22.5, 52.5], BOX);
        expect(iv[0]).toBeCloseTo(0.25);
        expect(iv[1]).toBeCloseTo(0.75);
    });
    it('covers the whole segment when it lies inside', () => {
        expect(segmentPolygonIntervals([21.2, 52.5], [21.8, 52.5], BOX)).toEqual([[0, 1]]);
    });
    it('returns nothing for a segment that misses the polygon', () => {
        expect(segmentPolygonIntervals([20, 54], [23, 54], BOX)).toEqual([]);
    });
    it('counts a leg along any edge as inside', () => {
        for (const [a, b] of [
            [[21.2, 53], [21.8, 53]],   // north
            [[21.2, 52], [21.8, 52]],   // south
            [[21, 52.2], [21, 52.8]],   // west
            [[22, 52.2], [22, 52.8]],   // east
        ]) expect(segmentPolygonIntervals(a, b, BOX)).toEqual([[0, 1]]);
    });
    it('counts a leg along a hole edge as inside', () => {
        const withHole = [BOX[0], square(21.25, 52.25, 0.5)[0]];
        expect(segmentPolygonIntervals([21.3, 52.75], [21.7, 52.75], withHole)).toEqual([[0, 1]]);
        expect(segmentPolygonIntervals([21.3, 52.25], [21.7, 52.25], withHole)).toEqual([[0, 1]]);
    });
    it('splits a leg that runs partly along an edge at the edge ends', () => {
        const [iv] = segmentPolygonIntervals([20.5, 53], [21.5, 53], BOX);
        expect(iv[0]).toBeCloseTo(0.5);
        expect(iv[1]).toBe(1);
    });
    it('returns a zero-length contact for a leg leaving from a boundary point', () => {
        expect(segmentPolygonIntervals([21.5, 53], [21.5, 53.5], BOX)).toEqual([[0, 0]]);
        expect(segmentPolygonIntervals([21.5, 53.5], [21.5, 53], BOX)).toEqual([[1, 1]]);
    });
    it('returns a zero-length contact for a leg touching a corner', () => {
        const [iv] = segmentPolygonIntervals([21.5, 53.5], [22.5, 52.5], BOX);
        expect(iv[0]).toBeCloseTo(0.5);
        expect(iv[1]).toBeCloseTo(0.5);
    });
    it('includes the stretch within the buffer of a polygon the leg does not enter', () => {
        // 0.01° lat ≈ 0.6 NM north of BOX's north edge
        expect(segmentPolygonIntervals([21.2, 53.01], [21.8, 53.01], BOX, 1)).toEqual([[0, 1]]);
        expect(segmentPolygonIntervals([21.2, 53.01], [21.8, 53.01], BOX, 0.5)).toEqual([]);
    });
    it('widens a crossing by the buffer on both sides', () => {
        // Leg along lat 52.5 from lon 20 to 23; BOX spans lon 21–22, 1 NM ≈ 0.0274° lon at 52.5°
        const [[t0, t1]] = segmentPolygonIntervals([20, 52.5], [23, 52.5], BOX, 1);
        const nmPerT = 3 * 60 * Math.cos(52.5 * Math.PI / 180);
        expect((1 / 3 - t0) * nmPerT).toBeCloseTo(1, 1);
        expect((t1 - 2 / 3) * nmPerT).toBeCloseTo(1, 1);
    });
    it('catches a corner that comes just inside the buffer', () => {
        // Triangle whose tip is 0.999 NM north of a leg along lat 52.5: only ~0.09 NM
        // of the leg is within 1 NM, shorter than any sampling step
        const tip = 52.5 + 0.999 / 60;
        const triangle = [[[21.5, tip], [21.6, tip + 0.1], [21.4, tip + 0.1], [21.5, tip]]];
        const ivs = segmentPolygonIntervals([21, 52.5], [22, 52.5], triangle, 1);
        expect(ivs).toHaveLength(1);
        expect(ivs[0][0]).toBeCloseTo(0.5, 2);
        expect(segmentPolygonIntervals([21, 52.5], [22, 52.5], triangle, 0.99)).toEqual([]);
    });
    it('returns two intervals for a concave polygon entered twice', () => {
        // U-shape open to the north: route along lat 52.8 crosses both arms
        const U = [[[21, 52], [22, 52], [22, 53], [21.7, 53], [21.7, 52.3], [21.3, 52.3], [21.3, 53], [21, 53], [21, 52]]];
        expect(segmentPolygonIntervals([20.5, 52.8], [22.5, 52.8], U)).toHaveLength(2);
    });
});

describe('AIRAC cycles', () => {
    const cycle = (designator, start, end, upper = 'A020') =>
        staticFeature(designator, 'CTR', 'GND', upper, BOX, { startTime: start, endTime: end });
    const CURRENT = ['2026-10-02T00:00:00Z', '2026-10-29T00:00:00Z'];
    const NEXT    = ['2026-10-29T00:00:00Z', '2026-11-26T00:00:00Z'];
    const features = [cycle('CTR A', ...NEXT, 'A030'), cycle('CTR A', ...CURRENT, 'A020'), cycle('CTR B', ...CURRENT)];

    it('lists the published cycles with their validity, oldest first', () => {
        expect(airacCycles(features)).toEqual([{ start: CURRENT[0], end: CURRENT[1] }, { start: NEXT[0], end: NEXT[1] }]);
    });
    it('keeps only the chosen cycle', () => {
        expect(staticAirspaceForCycle(features, NEXT[0]).map(f => f.properties.upperAltitude)).toEqual(['A030']);
        expect(staticAirspaceForCycle(features, CURRENT[0])).toHaveLength(2);
    });
    it('picks the cycle in force at a time, else the latest', () => {
        const cycles = airacCycles(features);
        expect(cycleInForce(cycles, Date.parse('2026-10-27T19:00:00Z')).start).toBe(CURRENT[0]);
        expect(cycleInForce(cycles, Date.parse('2026-11-01T00:00:00Z')).start).toBe(NEXT[0]);
        expect(cycleInForce(cycles, Date.parse('2026-12-01T00:00:00Z')).start).toBe(NEXT[0]);
        expect(cycleInForce([], Date.now())).toBeNull();
    });
    it('keeps features without validity dates whatever the cycle', () => {
        const undated = staticFeature('P1', 'P', 'GND', 'A010');
        expect(airacCycles([undated])).toEqual([]);
        expect(staticAirspaceForCycle([undated, ...features], NEXT[0])).toHaveLength(2);
    });
});

describe('buildAirspaces', () => {
    it('keeps static features that differ only in ATS frequencies', () => {
        const a = staticFeature('CTR EPXX', 'CTR', 'GND', 'A020', BOX, { services: [{ type: 'TWR', frequencies: ['118.100 MHZ'] }] });
        const b = staticFeature('CTR EPXX', 'CTR', 'GND', 'A020', BOX, { services: [{ type: 'TWR', frequencies: ['119.200 MHZ'] }] });
        expect(buildAirspaces([a, b])).toHaveLength(2);
    });
    it('drops duplicate static features', () => {
        const f = staticFeature('CTR EPXX', 'CTR', 'GND', 'A020');
        expect(buildAirspaces([f, f])).toHaveLength(1);
    });
    it('keeps static features that differ only after the first vertex', () => {
        const a = staticFeature('R1', 'R', 'GND', 'A020', BOX);
        const b = staticFeature('R1', 'R', 'GND', 'A020', [[[21, 52], [23, 52], [23, 54], [21, 54], [21, 52]]]);
        expect(buildAirspaces([a, b])).toHaveLength(2);
    });
    it('keeps reserved areas that share a designator and first vertex but differ in shape', () => {
        const r = [['2026-10-25T06:00:00Z', '2026-10-26T06:00:00Z', 'GND', 'A061']];
        const a = reservedFeature('EPTR1', 'TRA', r, BOX);
        const b = reservedFeature('EPTR1', 'TRA', r, [[[21, 52], [23, 52], [23, 54], [21, 54], [21, 52]]]);
        expect(buildAirspaces([], [[a], [b]])).toHaveLength(2);
    });
    it('takes unit and remarks from the later layer for the same reservation', () => {
        const r = ['2026-10-25T06:00:00Z', '2026-10-26T06:00:00Z', 'GND', 'A061'];
        const aup = reservedFeature('EPTR1', 'TRA', [r]);
        const uup = reservedFeature('EPTR1', 'TRA', [r]);
        uup.properties.airspaceReservations[0].unit = 'EPKK';
        uup.properties.airspaceReservations[0].remarks = 'GLD';
        const [as] = buildAirspaces([], [[aup], [uup]]);
        expect(as.reservations).toHaveLength(1);
        expect(as.reservations[0].unit).toBe('EPKK');
        expect(as.reservations[0].remarks).toBe('GLD');
    });
    it('lets an explicitly empty unit or remarks in a later layer clear the earlier value', () => {
        const r = ['2026-10-25T06:00:00Z', '2026-10-26T06:00:00Z', 'GND', 'A061'];
        const aup = reservedFeature('EPTR1', 'TRA', [r]);
        aup.properties.airspaceReservations[0].remarks = 'OLD';
        const uup = reservedFeature('EPTR1', 'TRA', [r]);
        uup.properties.airspaceReservations[0].remarks = '';
        delete uup.properties.airspaceReservations[0].unit;
        const [as] = buildAirspaces([], [[aup], [uup]]);
        expect(as.reservations[0].remarks).toBe('');
        expect(as.reservations[0].unit).toBe('MIL');
    });
    it('records which layer(s) each reservation came from', () => {
        const r1 = ['2026-10-25T06:00:00Z', '2026-10-26T06:00:00Z', 'GND', 'A061'];
        const r2 = ['2026-10-25T16:00:00Z', '2026-10-25T18:00:00Z', 'GND', 'F095'];
        const r3 = ['2026-10-26T06:00:00Z', '2026-10-27T06:00:00Z', 'GND', 'A061'];
        const [as] = buildAirspaces([], [
            { source: 'AUP',      features: [reservedFeature('EPTR1', 'TRA', [r1])] },
            { source: 'UUP',      features: [reservedFeature('EPTR1', 'TRA', [r1, r2])] },
            { source: 'next AUP', features: [reservedFeature('EPTR1', 'TRA', [r3])] },
        ]);
        expect(as.reservations.map(r => r.sources)).toEqual([['AUP', 'UUP'], ['UUP'], ['next AUP']]);
    });
    it('merges reservation layers per area and dedupes reservations', () => {
        const r = ['2026-10-25T06:00:00Z', '2026-10-26T06:00:00Z', 'GND', 'A061'];
        const aup = [reservedFeature('EPTR1', 'TRA', [r])];
        const uup = [reservedFeature('EPTR1', 'TRA', [[...r.slice(0, 4), 'ACTIVATED'],
                                                    ['2026-10-25T16:00:00Z', '2026-10-25T18:00:00Z', 'GND', 'F095']])];
        const [as] = buildAirspaces([], [aup, uup]);
        expect(as.reservations).toHaveLength(2);
        expect(as.reservations[0].status).toBe('ACTIVATED');
        expect(as.reservations[1].upperFt).toBe(9500);
    });
});

describe('findAirspaceCrossings', () => {
    const DEP = new Date('2026-10-25T10:00:00Z');

    it('reports entry/exit distance and time, merged across a waypoint', () => {
        const as = buildAirspaces([staticFeature('TMA EPXX', 'TMA', 'A020', 'F095')]);
        const [c] = findAirspaceCrossings(ROUTE, ROUTE_LEGS, as, { cruiseAltFt: 3500, departure: DEP });
        expect(c.status).toBe('controlled');
        expect(c.enterLeg).toBe(0);
        expect(c.exitLeg).toBe(1);
        expect(c.enterNm).toBeCloseTo(20);
        expect(c.exitNm).toBeCloseTo(60);
        expect(c.enterTime.toISOString()).toBe('2026-10-25T10:30:00.000Z');
        expect(c.exitTime.toISOString()).toBe('2026-10-25T11:30:00.000Z');
    });

    it('skips static airspace starting above cruise + vertical buffer, keeps airspace below', () => {
        const as = buildAirspaces([staticFeature('TMA HIGH', 'TMA', 'A065', 'F095'),
                                   staticFeature('TMA NEAR', 'TMA', 'A038', 'F095'),
                                   staticFeature('EPP1', 'P', 'GND', 'A010')]);
        const names = opts => findAirspaceCrossings(ROUTE, ROUTE_LEGS, as, opts).map(c => c.designator).sort();
        expect(names({ cruiseAltFt: 3500 })).toEqual(['EPP1']);
        expect(names({ cruiseAltFt: 3500, verticalBufferFt: 500 })).toEqual(['EPP1', 'TMA NEAR']);
    });

    it('marks airspace entirely below cruise as below', () => {
        const as = buildAirspaces([staticFeature('EPP1', 'P', 'GND', 'A010'), staticFeature('TMA', 'TMA', 'A020', 'F095')]);
        const below = Object.fromEntries(findAirspaceCrossings(ROUTE, ROUTE_LEGS, as, { cruiseAltFt: 3500 })
            .map(c => [c.designator, c.belowCruise]));
        expect(below).toEqual({ EPP1: true, TMA: false });
    });

    it('checks airspace at departure/destination from the surface up', () => {
        const ctr = staticFeature('CTR EPAA', 'CTR', 'GND', 'A020', square(20.4, 52.4, 0.2));
        const [c] = findAirspaceCrossings(ROUTE, ROUTE_LEGS, buildAirspaces([ctr]), { cruiseAltFt: 3500 });
        expect(c.designator).toBe('CTR EPAA');
        expect(c.enterNm).toBe(0);
    });

    it('reports a CTR whose boundary the departure or destination lies on', () => {
        // Route starts on the CTR's east edge and leaves eastwards; reversed, it ends there
        const ctr = staticFeature('CTR EPAA', 'CTR', 'GND', 'A020', square(20, 52, 0.5));
        const pts = [{ name: 'A', lat: 52.25, lon: 20.5 }, { name: 'B', lat: 52.25, lon: 21.5 }];
        const legs = [{ dist: 37, eteH: 0.5 }];
        for (const route of [pts, [...pts].reverse()]) {
            const [c] = findAirspaceCrossings(route, legs, buildAirspaces([ctr]), { cruiseAltFt: 3500, departure: DEP });
            expect(c?.designator).toBe('CTR EPAA');
            expect(c.enterNm).toBe(c.exitNm);
        }
    });

    it('counts a reservation active at the moment of a point contact', () => {
        const pts = [{ name: 'A', lat: 53, lon: 21.5 }, { name: 'B', lat: 53.5, lon: 21.5 }];
        const as = buildAirspaces([], [[reservedFeature('EPTS1', 'TSA',
            [['2026-10-25T09:00:00Z', '2026-10-25T10:00:00Z', 'GND', 'F095']])]]);
        const [c] = findAirspaceCrossings(pts, [{ dist: 30, eteH: 0.5 }], as, { cruiseAltFt: 3500, departure: DEP });
        expect(c.status).toBe('active');
    });

    it('keeps the full crossing when another part of the area touches its entry point', () => {
        const touching = [[[21, 52.5], [20.9, 52.7], [20.8, 52.7], [21, 52.5]]];
        const multi = {
            type: 'Feature',
            properties: { designator: 'TMA M', airspaceElementType: 'TMA', lowerAltitude: 'GND', upperAltitude: 'F095', services: [] },
            geometry: { type: 'MultiPolygon', coordinates: [BOX, touching] },
        };
        const crossings = findAirspaceCrossings(ROUTE, ROUTE_LEGS, buildAirspaces([multi]), { cruiseAltFt: 3500 });
        expect(crossings).toHaveLength(1);
        expect(crossings[0].enterNm).toBeCloseTo(20);
        expect(crossings[0].exitNm).toBeCloseTo(60);
    });

    it('marks reserved areas unverified instead of inactive when reservations are not reliable', () => {
        const as = buildAirspaces([], [[reservedFeature('EPTS1', 'TSA',
            [['2026-10-25T06:00:00Z', '2026-10-25T07:00:00Z', 'A025', 'F095']])]]);
        const opts = { cruiseAltFt: 3500, departure: DEP };
        expect(findAirspaceCrossings(ROUTE, ROUTE_LEGS, as, opts)[0].status).toBe('inactive');
        expect(findAirspaceCrossings(ROUTE, ROUTE_LEGS, as, { ...opts, reservationsReliable: false })[0].status).toBe('unverified');
    });

    it('maps P and R areas to their own status', () => {
        const as = buildAirspaces([staticFeature('EPP1', 'P', 'GND', 'A050'),
                                   staticFeature('EPR1', 'R', 'GND', 'A050', square(21.2, 52.2, 0.5))]);
        const statuses = findAirspaceCrossings(ROUTE, ROUTE_LEGS, as, { cruiseAltFt: 3500 }).map(c => c.status);
        expect(statuses.sort()).toEqual(['prohibited', 'restricted']);
    });

    it('marks a reserved area active only when time and altitude overlap', () => {
        const mk = (start, end, lo, hi) => buildAirspaces([], [[reservedFeature('EPTS1', 'TSA', [[start, end, lo, hi]])]]);
        const opts = { cruiseAltFt: 3500, departure: DEP };
        // Inside 10:30–11:30
        expect(findAirspaceCrossings(ROUTE, ROUTE_LEGS, mk('2026-10-25T11:00:00Z', '2026-10-25T12:00:00Z', 'A025', 'F095'), opts)[0].status).toBe('active');
        // Reservation ends before entry
        expect(findAirspaceCrossings(ROUTE, ROUTE_LEGS, mk('2026-10-25T08:00:00Z', '2026-10-25T10:30:00Z', 'A025', 'F095'), opts)[0].status).toBe('inactive');
        // Starts above cruise: not reported at all
        expect(findAirspaceCrossings(ROUTE, ROUTE_LEGS, mk('2026-10-25T06:00:00Z', '2026-10-26T06:00:00Z', 'F095', 'F245'), opts)).toEqual([]);
        // Entirely below cruise: still active, flagged below
        const [low] = findAirspaceCrossings(ROUTE, ROUTE_LEGS, mk('2026-10-25T06:00:00Z', '2026-10-26T06:00:00Z', 'GND', 'A020'), opts);
        expect(low).toMatchObject({ status: 'active', belowCruise: true });
        // Starts just above cruise: reported only within the vertical buffer
        const justAbove = mk('2026-10-25T06:00:00Z', '2026-10-26T06:00:00Z', 'A038', 'F095');
        expect(findAirspaceCrossings(ROUTE, ROUTE_LEGS, justAbove, opts)).toEqual([]);
        expect(findAirspaceCrossings(ROUTE, ROUTE_LEGS, justAbove, { ...opts, verticalBufferFt: 500 })[0].status).toBe('active');
    });

    it('treats a reservation with an invalid start or end time as a possible conflict', () => {
        const opts = { cruiseAltFt: 3500, departure: DEP };
        for (const [start, end] of [['bad', '2026-10-25T07:00:00Z'], ['2026-10-25T06:00:00Z', '']]) {
            const as = buildAirspaces([], [[reservedFeature('EPTS1', 'TSA', [[start, end, 'GND', 'F095']])]]);
            expect(findAirspaceCrossings(ROUTE, ROUTE_LEGS, as, opts)[0].status).toBe('active');
        }
    });

    it('keeps a reserved area as VERIFY when reservations are unreliable, whatever their limits', () => {
        const as = buildAirspaces([], [[reservedFeature('EPTS1', 'TSA',
            [['2026-10-25T06:00:00Z', '2026-10-26T06:00:00Z', 'F225', 'F315']])]]);
        const opts = { cruiseAltFt: 3500, departure: DEP, verticalBufferFt: 500 };
        expect(findAirspaceCrossings(ROUTE, ROUTE_LEGS, as, opts)).toEqual([]);
        expect(findAirspaceCrossings(ROUTE, ROUTE_LEGS, as, { ...opts, reservationsReliable: false })[0].status).toBe('unverified');
    });

    it('never marks an unverified area as below you', () => {
        const as = buildAirspaces([], [[reservedFeature('EPTS1', 'TSA',
            [['2026-10-20T06:00:00Z', '2026-10-21T06:00:00Z', 'GND', 'A020']])]]);
        const [c] = findAirspaceCrossings(ROUTE, ROUTE_LEGS, as, { cruiseAltFt: 3500, departure: DEP, reservationsReliable: false });
        expect(c).toMatchObject({ status: 'unverified', belowCruise: false });
    });

    it('shows a boundary contact at a waypoint under both legs that meet there', () => {
        // Waypoint B sits on BOX's north edge; both legs stay outside
        const pts = [{ name: 'A', lat: 53.5, lon: 21.2 }, { name: 'B', lat: 53, lon: 21.5 }, { name: 'C', lat: 53.5, lon: 21.8 }];
        const legs = [{ dist: 30, eteH: 0.5 }, { dist: 30, eteH: 0.5 }];
        const as = buildAirspaces([staticFeature('CTR X', 'CTR', 'GND', 'A020')]);
        const crossings = findAirspaceCrossings(pts, legs, as, { cruiseAltFt: 3500 });
        expect(crossingsByLeg(crossings, legs).map(l => l.length)).toEqual([1, 1]);
    });

    it('treats missing departure time and cruise altitude as conflicting', () => {
        const as = buildAirspaces([], [[reservedFeature('EPTS1', 'TSA', [['2026-10-25T06:00:00Z', '2026-10-25T07:00:00Z', 'F095', 'F245']])]]);
        const [c] = findAirspaceCrossings(ROUTE, ROUTE_LEGS, as);
        expect(c.status).toBe('active');
        expect(c.enterTime).toBeNull();
    });

    it('reports airspace within the buffer with its distance from the route', () => {
        // Square 0.6 NM north of the route (route along lat 52.5, square from 52.51)
        const near = staticFeature('TMA NEAR', 'TMA', 'GND', 'F095', square(21.2, 52.51, 0.2));
        const as = buildAirspaces([near]);
        const [c] = findAirspaceCrossings(ROUTE, ROUTE_LEGS, as, { cruiseAltFt: 3500, bufferNm: 1 });
        expect(c.designator).toBe('TMA NEAR');
        expect(c.distanceNm).toBeCloseTo(0.6, 1);
        expect(findAirspaceCrossings(ROUTE, ROUTE_LEGS, as, { cruiseAltFt: 3500, bufferNm: 0.5 })).toEqual([]);
    });

    it('reports the closest approach to a vertex pointing at the route', () => {
        const tip = 52.5 + 0.8 / 60;   // 0.8 NM north of the route along lat 52.5
        const triangle = staticFeature('R TIP', 'R', 'GND', 'A050', [[[21.5, tip], [21.6, tip + 0.1], [21.4, tip + 0.1], [21.5, tip]]]);
        const [c] = findAirspaceCrossings(ROUTE, ROUTE_LEGS, buildAirspaces([triangle]), { cruiseAltFt: 3500, bufferNm: 1 });
        expect(c.distanceNm).toBeCloseTo(0.8, 2);
    });

    it('gives distance 0 for airspace the route enters', () => {
        const as = buildAirspaces([staticFeature('TMA EPXX', 'TMA', 'A020', 'F095')]);
        const [c] = findAirspaceCrossings(ROUTE, ROUTE_LEGS, as, { cruiseAltFt: 3500, bufferNm: 1 });
        expect(c.distanceNm).toBe(0);
    });

    it('ignores airspace off the route', () => {
        const as = buildAirspaces([staticFeature('TMA FAR', 'TMA', 'GND', 'UNL', square(30, 60))]);
        expect(findAirspaceCrossings(ROUTE, ROUTE_LEGS, as, { cruiseAltFt: 3500 })).toEqual([]);
    });
});

describe('crossingsByLeg', () => {
    const DEP = new Date('2026-10-25T10:00:00Z');
    // Two legs of 40 NM, 1 h each; crossing from 20 NM (leg 0) to 60 NM (leg 1)
    const crossing = { designator: 'TMA X', enterLeg: 0, exitLeg: 1, enterNm: 20, exitNm: 60,
                       enterTime: new Date('2026-10-25T10:30:00Z'), exitTime: new Date('2026-10-25T11:30:00Z') };

    it('splits a crossing into the part on each leg, with leg-relative NM and times', () => {
        const [leg0, leg1] = crossingsByLeg([crossing], ROUTE_LEGS, DEP);
        expect(leg0).toHaveLength(1);
        expect(leg0[0]).toMatchObject({ designator: 'TMA X', legFromNm: 20, legToNm: 40, fromPrevLeg: false, toNextLeg: true });
        expect(leg0[0].legEnterTime.toISOString()).toBe('2026-10-25T10:30:00.000Z');
        expect(leg0[0].legExitTime.toISOString()).toBe('2026-10-25T11:00:00.000Z');
        expect(leg1[0]).toMatchObject({ legFromNm: 0, legToNm: 20, fromPrevLeg: true, toNextLeg: false });
        expect(leg1[0].legEnterTime.toISOString()).toBe('2026-10-25T11:00:00.000Z');
        expect(leg1[0].legExitTime.toISOString()).toBe('2026-10-25T11:30:00.000Z');
    });
    it('uses each leg\'s own ETE for times', () => {
        const legs = [{ dist: 40, eteH: 1 }, { dist: 40, eteH: 0.5 }];
        const [, leg1] = crossingsByLeg([crossing], legs, DEP);
        expect(leg1[0].legExitTime.toISOString()).toBe('2026-10-25T11:15:00.000Z');
    });
    it('leaves times empty without a departure time', () => {
        const [leg0] = crossingsByLeg([crossing], ROUTE_LEGS, null);
        expect(leg0[0].legEnterTime).toBeNull();
    });
    it('returns an empty list for legs with no airspace', () => {
        const only1 = { ...crossing, enterLeg: 1, enterNm: 50 };
        expect(crossingsByLeg([only1], ROUTE_LEGS, DEP)[0]).toEqual([]);
    });
});
