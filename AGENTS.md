# Taiwan Bus Tracker / G2BusTracker

## Working rules

- Read `/Users/jamie/.codex/LOCAL.md` first when present, then `/Users/jamie/.codex/RTK.md`. Use `rtk` for shell commands.
- Reply in Traditional Chinese; write new README files in English unless requested otherwise.
- Use the `even-hub-app-dev` skill for G2 changes and `ccsearch` for web research.
- Inspect Git status and recent commits before editing. Preserve unrelated work and never commit secrets, device identifiers, runtime data, dependencies, or generated packages.
- Keep this file current when architecture, behavior, commands, or deployment changes. Separate local tests, Simulator results, historical reports, and actual physical-device evidence.

## Product and current state

- App version `0.10.12`, package ID `dev.oruka.taiwanbus`; TypeScript/Vite phone WebView app for Even Realities G2, not code running directly on the glasses.
- Phone and G2 offer home, favorites, nearby stops, stop arrivals, and route detail. Phone manages favorite groups and routes; G2 is read-only.
- Uses the Greater Taipei public bus feeds. Default location is Taipei Main Station until phone GPS is available; location stays local to distance calculations. Continuous medium-accuracy GPS runs only on the nearby list and stops when leaving it. There is no startup high-accuracy location request.
- Refreshes ETAs/vehicles every five seconds. Keep source update time distinct from receipt time; do not fabricate arrivals or plates.
- SDK is pinned to `0.0.12`, CLI `0.1.13`, Simulator `0.8.0`. Read installed README/types before relying on SDK behavior. App manifest requires Even App `2.0.0` and location/network permissions.

## Code map

- `src/main.ts`: Bridge startup/queue, shared navigation state, phone DOM, G2 containers, images, input handling, GPS, feed loading, favorite management, and vehicle-to-stop mapping.
- `src/arrivals.ts`: shared ETA validation (missing/invalid values stay unknown), one entry per route ID; initially choose earliest direction, preserve preferred direction and ordering during refresh.
- `src/station-clustering.ts`: same-name physical groups within 80 m; complementary opposite-direction groups may merge only within a complete 150 m diameter, without chained merging.
- `src/presented-list.ts`: commit successfully presented list snapshots; gestures must resolve against what G2 has actually been shown.
- `src/presented-text.ts`: remember accepted text for the current layout; identical upgrades skip the Bridge, failures remain eligible for another update, and rebuilds reset the snapshot.
- `src/versioned-storage.ts`: revision-based reconciliation of phone and Host favorite storage.
- `server/server.mjs` / `server/cache-policy.mjs`: public gzip-feed proxy, request deduplication, prewarming, bounded stale responses, CORS and health endpoint.
- `server/upstream-fetch.mjs`: upstream download, including response-stream errors and timeout cleanup.
- `tests/`: Node tests for arrivals, clustering, presented lists, storage, proxy cache/downloads and isolated production `main.ts` scheduling/lifecycle functions. These do not cover physical image delivery or the full DOM UI.
- `SIMULATOR_VALIDATION.md` and `simulator-validation/`: historical validation, not proof that the currently installed G2 build works.

## Rendering and input contracts

- Wait for Bridge, create startup once, then rebuild for structural changes and upgrade matching ID/name containers for content changes.
- All native calls pass through `serializeBridgeCall`; image work additionally has its own queue. Render phone state without awaiting glasses transfers.
- Route content updates wait for initial page creation and run serially. Superseded direction work is discarded at actual Bridge dispatch; an accepted fallback rebuild synchronizes the layout before the next content update.
- Phone arrivals and route stops retain DOM rows across refreshes; update only changed text, classes and plates. Empty favorite groups do not download ETA. Favorite gestures resolve against the last successfully presented entries and selection.
- Host foreground exit pauses refreshes, aborts downloads and stops GPS; foreground entry restores the current page. System/abnormal exit and non-persisted `pagehide` also remove the Hub subscription. Persisted `pagehide`/`pageshow` pause/resume for BFCache. Do not pause solely on phone document visibility, since G2 can remain in use.
- Page tokens use `pageMode` plus `etaRefreshEpoch`; direction-image work additionally uses `glassesRouteImageEpoch` and selected direction. Check staleness after asynchronous work and at actual dispatch.
- Exactly one event-capture container per G2 page. Canvas is 576 × 288.
- Route detail: six native text containers (header, timestamp, four bordered stop rows) plus two 288 × 42 direction images. The table rows themselves are not images.
- Direction images try session-preferred `raw4`/PNG, defaulting to raw4 first. Initial wait is 650 ms; only `sendFailed` retries once after 700 ms per format. These are compatibility heuristics, not measured readiness guarantees.
- Route fallback currently collapses to three text containers on rejected initial rebuild or failed direction images. Once selected, content updates and direction switching stay in fallback until route page re-entry. Successful fallback clears the image diagnostic. See `ROUTE_DISPLAY_INVESTIGATION.md` before modifying this behavior.
- Route gestures: up/down scroll stops, click switches direction, double-click returns to the originating stop/favorites page. Favorites: up cycles groups, down cycles routes, click opens route. Nearby list: up/down select, click opens stop. Home double-click asks the Host to exit.

## Run and verify

```sh
rtk npm ci
rtk npm test
rtk npm run build
rtk npm run dev
rtk npm run simulate:automation
# After a successful build, if a package is needed:
rtk npm run pack
```

- Development and tests require Node `>=22.12.0` (Vite plus Node type stripping).
- Vite uses port 5173, strict port, all interfaces; Simulator automation script uses 9898. Do not interrupt unrelated apps occupying these ports; choose isolated ports explicitly.
- For changed UI/gestures, run official Simulator, exercise affected paths, inspect framebuffer and console. GPS APIs are historically unsupported by Simulator 0.8.0.
- For real-G2 image failures, collect the installed app version, Even App/firmware versions, exact rebuild/image return values, operation timing, and whether failure occurred on entry or switching direction. Simulator cannot validate BLE reliability.
- Before release, keep package/lockfile/app manifest, package filename, server metadata and docs versions aligned; use the skill's version checker and validate EHPK contents. Do not claim upload or device installation without verifying it.

## Deployment boundary

- Client targets `https://taiwan-bus.0ruka.dev/blobbus/{GetStop,GetRoute,GetEstimateTime,GetBusData}.gz`.
- Repository docs describe the proxy on Raspberry Pi 5. Checked-in service uses `/opt/taiwan-bus-g2-proxy`, loopback port 8893 and user/group `jamie`. This is documented configuration, not a fresh remote inspection.
- Static feed cache TTL is five minutes; dynamic TTL is two seconds with bounded stale allowance. Preserve the no-credentials-in-client design.
- The September 2026 local review includes tests, browser DOM/Bridge mocks and official Simulator interaction checks. It does not establish physical GPS/lifecycle/BLE behavior or measured power/temperature reduction. No deployment, release upload or remote service changes were performed.
