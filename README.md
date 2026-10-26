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
| Cruise Altitude | Feet MSL — used for VOR range and the airspace check |
| Departure | UTC, optional — used to check AUP reservations against the time you're inside each area |

Magnetic declination is fetched automatically from the [NOAA IGRF API](https://www.ngdc.noaa.gov/geomag/calculators/magcalc.shtml) for the route centroid. Requires internet access.

### Airspace check

The route is checked against Polish airspace published by PANSA:

- **Reservations** (TRA, TSA, D, R, ATZ…) from the current AUP, UUP and next-day AUP — flagged *ACTIVE* when a reservation overlaps your cruise altitude and the time you're inside the area
- **Static airspace** (CTR, TMA, MCTR, MTMA, P, R, ADIZ) — flagged when it overlaps your altitude, with ATS frequencies. PANSA publishes it per AIRAC cycle (usually the cycle in force and the next one); the check uses the cycle in force on the flight date and warns when no published cycle covers it

Airspace touching the departure or destination is checked from the surface up to cruise. Missing altitude or departure time is treated as a possible conflict. It is a planning aid — always check the current AUP/UUP and NOTAMs.

PANSA's API doesn't allow cross-origin requests, so the data is downloaded at deploy time: `.github/workflows/pages.yml` runs `scripts/fetch-airspace.mjs` every 30 minutes and deploys it with the site to `data/airspace/`. GitHub Pages must use **Settings → Pages → Source: GitHub Actions**.

## Development

### Structure

```
index.html        # UI — form, rendering, NOAA fetch
js/planner.js     # Pure logic — GPX parsing, nav math, wind calc, airspace crossings
scripts/          # fetch-airspace.mjs — downloads PANSA airspace into data/airspace/
tests/            # Vitest unit tests
assets/           # Example GPX and original flight plan template
```

### Setup

```
npm install
```

To get airspace data locally (git-ignored):

```
npm run fetch-airspace
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
