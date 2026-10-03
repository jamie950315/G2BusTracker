# Taiwan Bus Tracker — Even Realities G2

English | [繁體中文](README.md)

A real-time Taiwan bus tracker built for Even Realities G2 and Even Hub. It currently focuses on the Greater Taipei bus network and provides nearby stops, live arrivals, full route sequences, vehicle positions and license plates, plus grouped favorite routes.

Current version: `0.10.16`

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

Output: `taiwan-bus-g2-v0.10.16.ehpk`

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

- Serializes native page operations through one Promise queue; system exit requests serialize dispatch without holding that queue for the Host dialog response.
- Shares identical in-flight data requests.
- Runs network fetches and G2 page creation concurrently, but waits for target containers before updating G2.
- Rechecks page generation, image generation, and direction after waits and retries so stale work cannot overwrite a newer page.
- Remembers the image format accepted by the current Host session, with a bounded alternate-format fallback and a three-text-container compatibility page.
- Uses text upgrades instead of page rebuilds for five-second refreshes, preserving selection and scroll position.

## Validation status

Version `0.10.16` corrects the native foreground-layer lifecycle using the user's physical `0.10.15` trace. Layer entry (`4`) pauses app work; layer closure (`5`) restores the current page and input. System/abnormal exits still dispose the app. The previous mapping set `active=false` after No, so received taps and double taps were discarded.

- All 54 tests passed. A regression with the recorded `3 → shutdown accepted → 4 → 5 → list/sys taps` sequence fails on `0.10.15` and passes after the fix. It also covers a second `4 → 5` cycle without a new exit request. The real Host dialog result remains outside the render queue.
- Production build, version check and packaging passed on 2026-10-04 (Asia/Taipei). This exact candidate has diagnostics disabled; there is no phone trace panel or independent observer in its normal build.
- The final build passed the 12-input official Simulator flow through home, nearby stops, arrivals, route directions, favorites, back navigation and exit, with no console errors. The Simulator cannot exercise No; this remains separate from physical verification.
- Artifact: `taiwan-bus-g2-v0.10.16.ehpk`, **1,082,471 bytes**; SHA-256: `3d18b0b74f32cff9b14205df06193b9eea7563a2a1d731c59b0ea1b0917f0dd3`.
- The final candidate still requires physical No/click/double-click verification before public submission. The user's trace establishes the faulty state transition; it is not a completed `0.10.16` device test. Host/firmware versions and power/temperature measurements are unavailable. The proxy has not been deployed.

### Diagnostic investigation

Version `0.10.15` is a Private diagnostic build, not a verified cancellation fix. The user confirmed that installed `0.10.14` still loses taps after No. The exact Host event/state sequence must be captured before another corrective change or public submission.

- Build diagnostics with `VITE_INPUT_DIAGNOSTICS=0.10.15 npm run build`, then `npm run pack`. An ordinary production build omits the phone diagnostics panel and independent observer.
- The local phone panel retains only the latest 64 operational entries: event codes, numeric container/selection fields, active/disposed state, page lifecycle and Bridge dispatch/results. It records no raw payloads, identifiers, coordinates or content, and sends no diagnostic data over the network. Its independent SDK listener continues observing after the main handler unsubscribes.
- All 53 tests passed; the affected 14 runtime tests also passed after enabling diagnostics in the pending-exit regression. Production build, version check and packaging passed. The diagnostic panel displayed safe events and real Bridge results in a five-input official Simulator flow with no console errors. This does not verify physical cancellation.
- Diagnostic artifact: `taiwan-bus-g2-v0.10.15.ehpk`, **1,083,929 bytes**; SHA-256: `e219667b7f9be9e1eb966191e738de02c8cccea55735589df2785741da59d21b`.
- Uploaded on 2026-10-03 (Asia/Taipei) from source commit `257dcbc`; an independent Even Hub reload confirmed **Private**. Public submission remains pending resolution and physical verification of the cancellation failure.
- The user's trace received on 2026-10-04 shows native `4 → 5` followed by sys double-taps and list clicks while `active=false`, `disposed=false`. This directly identifies the app's incorrect foreground-layer mapping. Diagnostics now label internal state actions separately from incoming SDK event codes.

### Previous candidate

Version `0.10.14` was built and packaged on 2026-10-03 (Asia/Taipei) for physical-device verification. System exit requests now serialize dispatch only: an unfinished Host dialog response cannot block later native page operations or another exit request. This removes the queue deadlock without assuming that No emits a foreground event or returns a particular boolean.

- All 49 tests passed. The new regression fails on `0.10.13` when the Host leaves its exit response pending; the corrected production functions permit subsequent tap navigation, text updates and another double-tap exit request. An existing render still completes before exit dispatch.
- The final production build, version check, and CLI `0.1.13` packaging passed using SDK `0.0.14` and Node `23.11.0`. Even App `2.2.9` or newer is required. Packaging inputs contain only the manifest, HTML, JavaScript, and bundled font.
- The final build passed a 12-input official Simulator `0.8.0` flow through home, nearby stops, arrivals, route directions, favorites, back navigation and exit, with no console errors. Simulator cannot exercise No: its exit implementation clears the framebuffer without a confirmation dialog. Controlled Host tests establish queue behavior, not the real G2 cancellation sequence.
- Artifact: `taiwan-bus-g2-v0.10.14.ehpk`, **1,082,420 bytes**; SHA-256: `5dbb2b55bdd9cf75437abcba6317812c6fa74b7fc5db673cb8a0b24b4f827c70`.
- Uploaded to Even Hub on 2026-10-03 (Asia/Taipei); an independent reload confirmed `0.10.14` under **Private builds**. Source commit: `9f960ba`. It has not been submitted for public review; the public build remains `0.10.11`.
- Physical-device cancellation verification is required before another public submission. Host/firmware versions, BLE reliability, and power/temperature measurements remain unverified. The server changes have not been deployed.

### Historical validation

Version `0.10.13` was submitted on 2026-10-03 at 21:31 (Asia/Taipei), but the user confirmed that the installed build still loses taps after No. Its foreground-event tests did not reproduce an unfinished Host exit response. That submission is not evidence of a working fix.

Version `0.10.12` passed 45 tests and Simulator checks before submission on 2026-09-30. Even Hub rejected it on 2026-10-03 at 20:31 (Asia/Taipei) because taps stopped working after cancelling the system exit dialog. Its SDK was `0.0.12`; version `0.10.13` updates it to the current submission floor of `0.0.14`.

Version `0.10.11` was operated in the official Simulator `0.8.0` against the production real-time API. The exercised flow covered conditional merging through 150 meters, nearby stops, and one-row-per-route stop details:

- Tianmu Baseball Stadium (Zhongcheng) and Tianmu Baseball Stadium (Shidong) each appear once in the nearby list, and a Route ID appears only once within a stop detail.
- Automated tests, the production build, packaging, and the Simulator gesture flow passed.
- See [SIMULATOR_VALIDATION.md](SIMULATOR_VALIDATION.md) for the environment, exact steps, and captured evidence.

The Simulator cannot fully replace BLE, Host, and G2 firmware testing. Direction images therefore retain format probing, bounded retries, cross-page invalidation, and a text compatibility layout.

## License

No open-source license has been selected yet. Add an appropriate `LICENSE` before publishing the repository if you intend to permit reuse or external contributions.
