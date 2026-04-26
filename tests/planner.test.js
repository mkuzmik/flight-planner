import { describe, it, expect } from 'vitest';
import {
    parseGpx, trueCourse, distanceNm,
    computeWca, computeGs, computeLegs,
    computeFuelSummary,
    fmtTime, r0, r1, r2,
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
