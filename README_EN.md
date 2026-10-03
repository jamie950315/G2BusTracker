# Taiwan Bus Tracker — Even Realities G2

English | [繁體中文](README.md)

A real-time Taiwan bus tracker built for Even Realities G2 and Even Hub. It currently focuses on the Greater Taipei bus network and provides nearby stops, live arrivals, full route sequences, vehicle positions and license plates, plus grouped favorite routes.

Current version: `0.10.13`

## Features

- Starts from Taipei Main Station and automatically switches to the phone's GPS location when available. GPS runs only on the nearby-stop page and stops when leaving it.
- Lists the 20 nearest stops by straight-line distance with their serving routes.
- First forms physical same-name groups within 80 meters. Separate groups merge only when they share opposite directions of one route and every resulting position remains within a 150-meter diameter. Each location permits at most one complementary merge so it cannot chain through a third stop. Stop details show each route once, initially choose the soonest-arriving direction, keep that direction stable during refreshes, and still allow manual switching on the route page.
- Refreshes live arrivals every five seconds without resetting phone scroll, G2 selection, or pagination.
- Shows the full stop sequence, both directions, stop-level ETAs, the selected stop, and live vehicle plates.
- Normalizes Route IDs and `pathAttributeId`, then maps vehicles within 500 meters to the nearest stop on the same route and direction.
- Lets phone users search routes, star favorite stops, and create, rename, or delete custom groups.
- Keeps G2 read-only for fast viewing; favorite and group management stays on the phone.
- Displays the source update time in `HH:MM:SS` at the top-right of G2 detail pages.
- Renders phone navigation and starts data requests without waiting for G2 Bridge transfers, while keeping all glasses Bridge calls serialized.
- Uses no fake ETAs, vehicles, or plates. Failures are shown explicitly or served from the last successful proxy response.

## Controls

| Page | G2 swipe up | G2 swipe down | G2 click | G2 double-click | Phone |
|---|---|---|---|---|---|
| Home | Previous option | Next option | Open option | Exit the G2 page | Tap a feature |
| Favorites | Cycle groups | Cycle routes | Open route details | Return home | Tap tabs, search, star, and manage groups |
| Nearby stops | Previous stop | Next stop | Open stop details | Return home | Tap a stop |
| Stop details | Previous route | Next route | Open route details | Return to nearby stops | Back button or tap a route |
| Route details | Previous stop | Next stop | Toggle direction | Return to the previous page | Tap a direction tab; use the back button |

## Live data and privacy

The app connects to `https://taiwan-bus.0ruka.dev`, a real-time data proxy deployed on a Raspberry Pi 5. The proxy reads the public gzip feeds published by the Taipei City Public Transportation Office:

- `GetStop.gz`: stops and route stop sequences.
- `GetRoute.gz`: route names, origins, and destinations.
- `GetEstimateTime.gz`: real-time arrival estimates.
- `GetBusData.gz`: live vehicle coordinates, directions, and plates.

The proxy prewarms all four feeds, deduplicates upstream requests, and serves the last successful response immediately while revalidating expired data in the background. Responses expose cache state, age, and source timestamps. The UI displays the feed's `UpdateTime`, not the phone's receipt time.

Phone location is used locally only to calculate distance and sort nearby stops. Coordinates are not appended to the bus data requests above. The repository contains no TDX Client Secret or other API key.

## Requirements

- Node.js `>=22.12.0` (including TypeScript type stripping for tests)
- npm
- Even Realities App / Even Hub Host `2.0.0` or later
- Even Hub SDK `0.0.14` (Even App `2.2.9` or newer)
- Official Even Hub Simulator `0.8.0` (optional)

## Quick start

```bash
npm install
npm run dev
```

The development server listens on all network interfaces. For G2 device testing, place the phone and computer on the same local network, then run this in another terminal:

```bash
npx evenhub qr --url "http://YOUR_LAN_IP:5173"
```

Enable Developer Mode in the Even Realities App, scan the QR code, and grant location permission on first launch.

## Official Simulator

Terminal 1:

```bash
npm run dev
```

Terminal 2:

```bash
npm run simulate
```

For the automation API:

```bash
npm run simulate:automation
```

Native dependencies on Ubuntu / Debian:

```bash
sudo apt update
sudo apt install libwebkit2gtk-4.1-0 libjavascriptcoregtk-4.1-0 libsoup-3.0-0
```

Simulator `0.8.0` does not implement the GPS Bridge methods used by this app, so it falls back to the default Taipei coordinates. Real location permission and tracking must be verified with the Even Realities App and a G2 device.

## Build and package an EHPK

```bash
npm run build
npm run pack
```

Output: `taiwan-bus-g2-v0.10.13.ehpk`

You can inspect the final `dist` build first:

```bash
npm run preview
```

## Real-time data proxy

The proxy is implemented in `server/server.mjs` and listens on `127.0.0.1:8893` by default:

```bash
node server/server.mjs
```

For production, use `server/taiwan-bus-g2-proxy.service` with systemd and expose it through an HTTPS Cloudflare Tunnel. Do not publish the unprotected proxy port directly to the internet.

## Project structure

```text
.
├── app.json                         # Even Hub manifest and permissions
├── index.html                       # Phone WebView HTML and CSS
├── src/main.ts                      # State, data, GPS, phone UI, and G2 UI
├── server/server.mjs                # Live-data caching proxy
├── server/taiwan-bus-g2-proxy.service
├── SIMULATOR_VALIDATION.md          # Actual Simulator runs and regression evidence
├── README.md                        # Traditional Chinese documentation
└── README_EN.md                     # English documentation
```

## Reliability design

- Serializes every G2 Bridge call through one Promise queue.
- Shares identical in-flight data requests.
- Runs network fetches and G2 page creation concurrently, but waits for target containers before updating G2.
- Rechecks page generation, image generation, and direction after waits and retries so stale work cannot overwrite a newer page.
- Remembers the image format accepted by the current Host session, with a bounded alternate-format fallback and a three-text-container compatibility page.
- Uses text upgrades instead of page rebuilds for five-second refreshes, preserving selection and scroll position.

## Validation status

Version `0.10.13` was built, packaged and uploaded on 2026-10-03, then submitted for public release at 21:31 (Asia/Taipei). An independent portal reload confirmed **In review** with a **Submitted** record. It handles foreground events from system, text and list envelopes, restores native input capture on foreground return, and accepts system taps without a touch source. Native menu selection stays aligned with accepted page rebuilds. Publication requires Even Realities approval; the public build remains `0.10.11` while review is pending.

- All 48 tests passed, including controlled Host regressions for cancelled-dialog recovery, repeated double taps, confirmed exit, and native list selection.
- The final production build, version check, and CLI `0.1.13` packaging passed using SDK `0.0.14` and Node `23.11.0`. The manifest requires Even App `2.2.9` or newer. Packaging inputs contain only the manifest, HTML, JavaScript, and bundled font.
- Official Simulator `0.8.0` exercised 12 inputs through home, nearby stops, arrivals, route direction changes, favorites, back navigation, and system exit, with no console errors. Its exit implementation clears the framebuffer without a Yes/No dialog, so the actual cancellation sequence remains unverified on G2 hardware.
- Artifact: `taiwan-bus-g2-v0.10.13.ehpk`, **1,082,405 bytes**; SHA-256: `0043a165cd9b701c514304d79c1937e3010fc373f981a68efd0e71a5bcf6173d`.
- Physical-device installation, Host/firmware versions, BLE reliability, and power/temperature measurements remain unverified. The server changes have not been deployed.

### Historical validation

Version `0.10.12` passed 45 tests and Simulator checks before submission on 2026-09-30. Even Hub rejected it on 2026-10-03 at 20:31 (Asia/Taipei) because taps stopped working after cancelling the system exit dialog. Its SDK was `0.0.12`; version `0.10.13` updates it to the current submission floor of `0.0.14`.

Version `0.10.11` was operated in the official Simulator `0.8.0` against the production real-time API. The exercised flow covered conditional merging through 150 meters, nearby stops, and one-row-per-route stop details:

- Tianmu Baseball Stadium (Zhongcheng) and Tianmu Baseball Stadium (Shidong) each appear once in the nearby list, and a Route ID appears only once within a stop detail.
- Automated tests, the production build, packaging, and the Simulator gesture flow passed.
- See [SIMULATOR_VALIDATION.md](SIMULATOR_VALIDATION.md) for the environment, exact steps, and captured evidence.

The Simulator cannot fully replace BLE, Host, and G2 firmware testing. Direction images therefore retain format probing, bounded retries, cross-page invalidation, and a text compatibility layout.

## License

No open-source license has been selected yet. Add an appropriate `LICENSE` before publishing the repository if you intend to permit reuse or external contributions.
