# ✈ Flight Planner

A static web app for VFR pre-flight planning. Load a GPX route, enter wind and performance data, and get a full operational flight plan with magnetic courses, wind correction angles, ground speeds, ETEs, and fuel.

![CI](https://github.com/mkuzmik/flight-planner/actions/workflows/ci.yml/badge.svg)

## Using the app

**[Open on GitHub Pages](https://mkuzmik.github.io/flight-planner/)** — no install needed.

To run locally:

```
npx serve .
```

Then open `http://localhost:3000`.

### Inputs

| Field | Description |
|---|---|
| GPX File | Route file (`<rte>` or `<trk>`). See `assets/example_flight_log.gpx` for an example. |
| Wind Direction | Magnetic, degrees |
| Wind Speed | Knots |
| TAS | True airspeed, knots |
| Fuel Consumption | US gallons per hour |
| Date | Used to compute magnetic declination |
| Mag. Declination | Optional override — leave blank to auto-fetch from NOAA |

Magnetic declination is fetched automatically from the [NOAA IGRF API](https://www.ngdc.noaa.gov/geomag/calculators/magcalc.shtml) for the route centroid. Requires internet access; use the manual override if offline.

## Development

### Structure

```
index.html        # UI — form, rendering, NOAA fetch
js/planner.js     # Pure logic — GPX parsing, nav math, wind calc
tests/            # Vitest unit tests
assets/           # Example GPX and original flight plan template
```

### Setup

```
npm install
```

### Run tests

```
npm test
```

Tests cover GPX parsing, geodesic math, wind calculations, leg computation, and formatting. They run in a jsdom environment — no browser needed.

### Adding a feature

- Navigation logic goes in `js/planner.js` with a matching test in `tests/planner.test.js`
- UI-only changes (layout, rendering) go in `index.html`
- CI runs on every push and PR
