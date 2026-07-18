# ORBITAL/LIVE

ORBITAL/LIVE is an interactive 3D satellite tracker. It loads current TLE data
from CelesTrak, propagates satellite positions locally with SGP4, and renders the
result on a WebGL globe.

The interface currently includes Starlink, operational GPS satellites, and
space stations. Users can filter groups, search by name or NORAD ID, select a
satellite, inspect telemetry, and run the simulation at 1x, 10x, or 60x speed.

## Technology

- React 19 and Next.js 16 App Router
- vinext and Vite
- Three.js for WebGL rendering
- satellite.js for TLE parsing and SGP4 propagation
- Web Worker orbit calculations
- Cloudflare Workers deployment target

## Requirements

- Node.js 22.13 or newer

## Development

```bash
npm install
npm run dev
```

The development server prints the local URL after it starts.

## Verification

```bash
npm run lint
npm test
```

`npm test` creates a production build and verifies the rendered application
shell and API parameter validation.

## Data Flow

The browser requests each supported group from `/api/tle`. The API proxies
CelesTrak and applies a two-hour shared cache. If CelesTrak cannot be reached,
the API redirects to the bundled snapshot under `public/tle/`.

Orbit propagation runs entirely in `app/workers/orbit.worker.ts`, keeping SGP4
work off the main browser thread. TLE positions are predictions rather than
direct spacecraft telemetry, and their accuracy depends on the age and quality
of the source elements.

## Deployment

The repository is configured for vinext on Cloudflare Workers and for the
OpenAI Sites hosting flow. The current satellite experience does not require D1
or R2 bindings.

For an independent Cloudflare deployment, authenticate Wrangler with the target
account and build the generated Worker output:

```bash
npx wrangler login
npm run build
```

Review the generated `dist/server/wrangler.json` and the target account's Worker
name, routes, and image binding before deploying. Cloudflare account credentials
and IDs are intentionally not stored in this repository.

## Project Structure

- `app/page.tsx`: controls, search, telemetry, and simulation UI
- `app/components/GlobeSceneImpl.tsx`: Three.js scene and browser orchestration
- `app/workers/orbit.worker.ts`: TLE parsing and orbit propagation
- `app/api/tle/route.ts`: CelesTrak proxy and snapshot fallback
- `public/tle/`: bundled TLE snapshots
- `public/earth-night-lights-2016.jpg`: NASA Black Marble satellite-derived night-light composite
- `worker/index.ts`: Cloudflare Worker entry point
- `brand-spec.md`: visual direction

Satellite cards derive launch year from the two-digit launch year in the TLE
international designator. Ownership is a catalog classification for the
supported groups, not a field transmitted by the satellite; unknown ownership
is shown explicitly rather than guessed.

## Earth Night Lights

The globe uses NASA's 2016 Black Marble 0.1-degree global night-light composite
(`3600x1800`) as an emissive texture. The shader masks it with the calculated
solar direction, so lights are visible only on the simulated night side. This
is a historical satellite composite, not live city-light telemetry; NASA
describes the source as cloud-free monthly nighttime observations. Source:
<https://science.nasa.gov/earth/earth-observatory/earth-at-night/maps/>.
