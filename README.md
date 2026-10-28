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
| Departure | UTC, optional — used to check reservations against the time you're inside each area; without it every reservation in the chosen plan counts |
| Reservation Plan | Today (AUP + UUP) or Tomorrow (next-day AUP), each shown with its validity |
| AIRAC Cycle | Which published AIP cycle the airspace structures come from, shown with its validity (default: in force today) |
| Airspace Buffer | NM either side of the route (default 1) — airspace this close to the route is listed too |
| Vertical Buffer | ft above cruise (default 500) — airspace starting higher than cruise + this is left out; everything below is listed |

Magnetic declination is fetched automatically from the [NOAA IGRF API](https://www.ngdc.noaa.gov/geomag/calculators/magcalc.shtml) for the route centroid. Requires internet access.

### Airspace check

The route is checked against Polish airspace published by PANSA. Results appear under each leg of the plan table, with warnings and the data sources below it:

- **Reservations** (TRA, TSA, D, R, ATZ…) from the chosen plan — today's AUP + UUP or tomorrow's AUP — flagged *ACTIVE* when a reservation is in force while you're in or near the area and starts below cruise + vertical buffer
- **Static airspace** (CTR, TMA, MCTR, MTMA, P, R, ADIZ) — listed when it starts below cruise + vertical buffer, with ATS frequencies. PANSA publishes it per AIRAC cycle (usually the cycle in force and the next one); you choose the cycle, and the page warns when a departure time falls outside it

Airspace within the buffer (default 1 NM) of the route is listed too, with its closest distance when the route doesn't enter it. Each reservation is tagged with the PANSA file it comes from (AUP, UUP, next-day AUP), and the page lists the files used with their validity. Vertically, airspace starting more than the vertical buffer (default 500 ft) above cruise is left out; everything below cruise is listed and marked "below you" when it ends below cruise. Missing altitude or departure time is treated as a possible conflict. It is a planning aid — always check the current AUP/UUP and NOTAMs.

PANSA's API doesn't allow cross-origin requests, so the data is downloaded at deploy time: `.github/workflows/pages.yml` runs `scripts/fetch-airspace.mjs` twice a day — at 06:17 UTC, after the day's AUP takes effect (06:00), and at 16:17 UTC, after the next-day AUP is published — and deploys it with the site to `data/airspace/`. UUPs published between runs are not included, so today's reservations are only used to show an area is free for 2 h after the fetch; after that, reservable areas on the route are marked VERIFY. Tomorrow's AUP is used the same way once it takes effect (06:00 UTC) — before that, until a scheduled refresh is missed. The page warns when the data has missed a scheduled refresh (more than 2 h late). GitHub Pages must use **Settings → Pages → Source: GitHub Actions**.

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
- Working conventions (branches, issues, PR descriptions, review) are in `AGENTS.md`
