# Remaining iOS hangs: follow-up investigation

Verified against Sentry on 18 October 2026. Read-only investigation: no runtime
changes, SDK upgrades, alert suppression or issue-resolution mutations.

## Current-build findings

| Issue | Latest retained event | Build | Assessment |
| --- | --- | --- | --- |
| [4A](https://ogabassey-services-limited.sentry.io/issues/154270947/) | 17 Oct 12:34:07 UTC | 632 | Concrete Fabric scroll-container resize sample; owner and trigger remain unproven. |
| [2T](https://ogabassey-services-limited.sentry.io/issues/143807900/) | 17 Oct 10:19:49 UTC | 632 | 103.1–103.9-second detector report with idle main and JS stacks; possible detector error, not confirmed false positive. |
| [2N](https://ogabassey-services-limited.sentry.io/issues/143344726/) | 18 Oct 06:37:08 UTC | 559 | Termination preceded by two low-memory warnings; no jetsam report or blocking stack. |

### 4A: scroll-container resize after keyboard presentation

Event `add57b559cdd49e2a60a8cd8f73ed449`, route `/(tabs)`, iPhone11,8,
iOS 18.7.10. The app used about 235 MB; reported free memory was about 75 MB,
battery 5%, low-power mode enabled and thermal state serious. These are context,
not proof of a specific root cause.

Main stack: Fabric mounting transaction →
`RCTScrollViewComponentView.updateState:oldState:` → `UIView.setFrame:` →
`CALayer.setFrame:` → `objc_msgSend`. Keyboard-show notification was recorded at
12:34:04.919 UTC, about 2.8 seconds before detection.

The installed RN 0.86.2 implementation already returns early when content size is
unchanged. Adding another identical-size frame guard would duplicate the existing
check. This sample concerns a content-size change, not the generic clipping
conversion fixed in the previous change. The route alone cannot identify whether
the owner is the home feed, search suggestions or another mounted scroll view.
No non-main Yoga/image-decode stack identified a second active bottleneck.

Of the 100 retained breadcrumbs, 90 were HTTP entries: 71 image-file requests,
17 database REST requests, one application API request and one other request.
The remaining ten were keyboard/UI lifecycle events. Earlier home-state and
surface diagnostics are unavailable in this event.

Confirmed diagnostics gap: the JavaScript `beforeBreadcrumb` network filter in
`services/error-monitoring.ts` does not filter native Cocoa HTTP breadcrumbs.
The installed bridge's `ios/RNSentryStart.m` installs a separate native filter
that excludes only the Sentry DSN and development server. Native traffic can
therefore crowd the bounded breadcrumb buffer despite the JavaScript filter.
No request URLs, queries, headers or customer details were retained in this report.

### 2T: long duration with idle stacks

Event `6d1b9b106fbd4a14bd92db3afa3583c7`, route `/product/[slug]`, iPhone14,2,
iOS 26.6, serious thermal state. Both the main and React Native JS threads end in
an idle Mach-port run loop. No application deadlock or long-running function is
identified by this snapshot. The report uses Cocoa SDK 9.19.1.

Timestamp distinction matters. Sentry's integration captures the stack and event
at detection, stores that event, then updates its duration when the tracker says
the hang stopped. Event time is 10:19:49.781 UTC; server receipt is 10:21:42.942 UTC.
**Do not subtract 103 seconds from detection time and treat preceding breadcrumbs
as activity during the reported hang.** That would misread the SDK's timing.
The earlier navigation/keyboard/screenshot breadcrumbs do not disprove this hang.

Sentry maintainers acknowledge unreliable custom V1/V2 hang detection and, in
[their 16 October response](https://github.com/getsentry/sentry-cocoa/issues/9205),
recommend MetricKit diagnostics. The matching idle-stack symptom makes detector
error plausible, but does not establish that this specific event is false.
An SDK upgrade alone is not a demonstrated fix: the upstream report also describes
the problem on a newer SDK. Do not silence all hang alerts or mark 2T resolved.

2T also contains older, different samples on build 559: keyboard/autofill menus,
trait-tree propagation, edit-menu presentation and WebKit input focus. They must
not all be treated as the same idle-stack failure or declared fixed together.

Sources inspected:

- [Cocoa 9.19.1 hang integration](https://github.com/getsentry/sentry-cocoa/blob/9.19.1/Sources/Swift/Integrations/AppHangTracking/SentryHangTrackingIntegration.swift)
- [Cocoa 9.19.1 frame-delay detector](https://github.com/getsentry/sentry-cocoa/blob/9.19.1/Sources/Sentry/SentryANRTrackerV2.m)
- [Upstream detector report and maintainer response](https://github.com/getsentry/sentry-cocoa/issues/9205)

### 2N: memory pressure on old build

Event `b3cf5b89dd5a4b97b46a237020c08cb5`, build 559, iPhone10,1 / iOS 16.7.12.
A Fabric modal and keyboard presentation precede two native `LOW_MEMORY`
breadcrumbs at 06:37:08.834 and 06:37:08.858 UTC. Memory pressure is directly
observed. The generic watchdog classification still does not establish an OOM
kill; Apple's jetsam/termination report is missing. This is not evidence that the
newer 632/634 builds have the same termination failure.

## Other recent iOS groups

Latest retained events for these ten additional groups are all on build 559:

| Group | Sampled path |
| --- | --- |
| 48 | Hermes interpreter work |
| 3A | Core Graphics gradient/image rasterization |
| 36 | Keyboard autofill task-queue wait |
| 47 | Keyboard autocorrection task-queue wait |
| 37 | Label resize / trait propagation |
| 2H | Scroll-indicator layer appearance update |
| 46 | Recursive Yoga layout rounding |
| 3H | Image-data copying |
| 39 | WebKit touch-action descendant traversal |
| 45 | Keyboard autofill task-queue wait |

Their latest retained dates span 12–15 October. This is a per-group latest-event
check, not a claim that all historical occurrences were examined or that the older
problems are now fixed. Heat is common in these samples, but is not sufficient to
assign causality.

## Recommended next implementation

1. Apply a privacy-safe native breadcrumb policy consistent with the existing JS
   policy, preserving bounded route, focus, keyboard lifecycle and memory context.
2. Add Apple's MetricKit hang diagnostics through a verified native Sentry
   integration; preserve current alerts until the replacement is validated. This
   requires native integration/build verification, not merely a JavaScript option.
3. Profile the actual home/search keyboard resize on an affected OS/device with
   retained scroll-owner and content-size transition evidence. Keep the separate
   WebKit/autofill case in its own reproduction.

Trace-event correlation queries were rejected with HTTP 403 by the configured
Sentry credential. Issue/event reads worked; no credential changes were attempted.
No new reproduction or software test was claimed in this read-only follow-up.
The previous native fixes and their test results remain unchanged.
