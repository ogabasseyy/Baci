# Analytics wrapper lazy-loading investigation (#3672)

Baseline: remote main `26134bbee1a91e02a48a61de9a35cb988b19a5bc`. This is source analysis, not a production performance measurement.

## Current ownership

The issue's named `AnalyticsPixelProvider` now imports only `GoogleAnalytics`; the five advertising wrappers moved to the persistent server-side `storefront-shell-frame.tsx`, which renders each wrapper only when the corresponding merchant ID is configured. `platform-analytics-provider.tsx` is a distinct platform surface and must not be conflated with merchant storefront ownership.

The funnel module `apps/web/src/lib/analytics/track-social-funnel.ts` statically imports `tiktokEvents` and `snapchatEvents` from the respective wrapper modules. A dynamic import at the shell alone therefore cannot prove these wrappers are absent from the initial client graph. The module also drops an event immediately if `socialPixelContext.get(destination)` has no owner. Each wrapper activates its owner in `useLayoutEffect` after marketing consent. Delaying wrapper mount therefore introduces a window in which an otherwise eligible funnel event can be discarded before ownership exists. Buffering without an already-established tenant-bound owner would risk attributing an event to a later merchant or consent state.

The current [Next.js lazy-loading guidance](https://nextjs.org/docs/app/guides/lazy-loading) says automatic client code splitting is not supported when a Server Component dynamically imports a Client Component. The storefront shell is a Server Component, so the archived approach cannot be transplanted directly into this new location.

## Required experiment

1. Measure the actual initial storefront chunks and identify all static paths to each wrapper and event sender. Use a representative unconfigured merchant and a configured merchant.
2. Define a synchronous, tenant-bound ownership/consent contract before a deferred provider can receive events; cover a funnel event before module load, consent revoked before readiness, merchant switch, and page navigation. Preserve existing event IDs and provider delivery ordering.
3. Place any dynamic boundaries within a Client Component and remove or justify other static imports. Confirm missing/invalid IDs make no provider requests and no provider chunks are downloaded.
4. Compare production artifacts and route/cohort measurements for initial bytes, request waterfalls and event-delivery latency. Do not claim a performance win, close the issue, or roll out based solely on a source-level import change.
