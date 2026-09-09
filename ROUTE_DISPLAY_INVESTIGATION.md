# Route detail falling back to plain text

Investigation date: 2026-09-09. Source: `cbc1d0b`, app `0.10.11`, installed SDK `0.0.12`. Investigation only; rendering behavior was not changed.

## Confirmed mechanism

The app explicitly selects plain text; it is not merely firmware losing table styling.

1. `createGlassesRoutePage` in `src/main.ts` builds eight containers: header, timestamp, four native bordered text rows, and two direction-tab images. One `false` rebuild result immediately selects fallback without a rebuild retry.
2. After successful rebuild, direction images are sent after a 650 ms delay. Each format gets up to two attempts, with 700 ms between `sendFailed` results. Both formats failing on either tab selects fallback. `updateGlassesRouteText` also selects fallback if a later direction-image update fails.
3. `rebuildGlassesRouteFallback` replaces all four bordered rows and both image tabs with one multiline text region, retaining separate header/time containers. Thus an image-only problem unnecessarily loses the independently rendered table under the current policy.
4. In fallback mode, `updateGlassesRouteText` returns after updating that multiline region. Neither five-second refresh nor direction switching attempts to restore the richer page. Re-entering route detail runs page creation again.
5. Successful fallback sets `glassesImageDiagnostic = null`, removing the reason from the phone-facing state. Detailed format failures exist only in console output. Initial page rejection and image failure also converge on the same generic fallback log.

## What can explain the intermittent behavior?

The failure trigger can be transient while the resulting fallback persists for the page visit. An initial rebuild rejection or an exhausted image-send failure is sufficient. There is no route-ID-specific rule selecting plain text.

The repository's historical `SIMULATOR_VALIDATION.md`, section `0.10.8`, records a user-device report of `dir-tab-0: raw4=sendFailed, png=sendFailed`. The installed SDK distinguishes `sendFailed` from size/conversion errors. This supports image delivery failure as a plausible explanation, but is not a new measurement of the user's current device. It does not establish Bluetooth signal, firmware, Host readiness, or payload format as the underlying cause.

The layout is within the installed SDK's documented counts and image dimensions: eight total, six text, two images sized 288 × 42, unique IDs, exactly one event capture, and no mixed z-order. No obvious static count/dimension violation was found. This does not prove hardware accepts it reliably.

## Additional concurrency risk, not established as this incident's cause

`updateGlassesImage` checks no generation at actual shared-queue dispatch; its caller checks before enqueue and after completion. If a page/direction changes while that call waits, stale image work can still reach the Host. Text/rebuild wrappers do have dispatch-time token checks. Rapid input during route creation can also start direction updates before creation has fully settled. These should be covered by delayed-Bridge tests before any scheduling change; this investigation did not reproduce a physical failure from either path.

## Verification performed

- `rtk npm test`: 31/31 tests passed.
- `rtk npm run build`: TypeScript and Vite production build passed.
- A temporary Node/TypeScript AST harness executed the actual four functions (`createGlassesRoutePage`, `sendDirectionImage`, `rebuildGlassesRouteFallback`, `updateGlassesRouteText`) with controlled Bridge/image dependencies. All five checks passed: successful images retain table; one rebuild rejection selects fallback; initial image failure selects sticky fallback; later image failure removes an existing table; four failed sends exhaust formats and successful fallback clears the diagnostic.
- Harness path for this run: `/tmp/g2bus-investigation.XWwaX1/reproduce.cjs` (temporary, not a durable project dependency). Delays were stubbed; these checks establish application control flow, not transport timing or native rendering.
- No new Simulator session or physical G2 measurement was performed; no app source, version, deployed service or installed package was changed. Existing Simulator evidence must not be presented as current physical-device evidence.

## Recommended follow-up

Prefer keeping the four native table rows when direction images fail, replacing only the direction tabs with a native text row. Retain the compact three-container fallback as a last resort if that layout is rejected. This preserves usable formatting without repeatedly sending failing images. It requires target-device acceptance testing for the seven-text-container variant.

An alternative is bounded retry of the full rich page after a transient failure. It may restore image tabs, but adds delay, possible flicker and repeated traffic; retrying indefinitely on each five-second refresh is not recommended. Merely increasing fixed sleeps is not evidence-based without measured Host timings.

Before implementing, retain a bounded diagnostic containing failure stage, result, format, retry count and timing, and distinguish stale cancellation from real failure. Record current installed app/Even App/G2 firmware versions without serial numbers or location data. Reproduce entry, direction switch, rapid navigation and recovery on the actual G2. That evidence is required to identify why the Host rejected the operation in the user's current incident.
