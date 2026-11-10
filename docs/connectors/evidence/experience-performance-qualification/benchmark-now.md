# Immediate local Orbit benchmark

Existing production-mode synthetic fixture; four routes × two widths × three cold attempts. No application code or build was changed during the run. Native connectivity and Chrome device emulation; no network throttling. These are contention-affected diagnostics, not field CWV or release qualification.

**24 attempts: 16 produced complete metrics; 8 failed.** Failed attempts are retained and were not replaced by passing retries.

| Profile | Route | Measured / 3 | Failed | Median host LCP (ms) | Median raw frame LCP from host (ms) | Median presentation proxy (ms) | Max raw frame CLS |
|---|---|---:|---:|---:|---:|---:|---:|
| mobile-iphone-12-pro | home | 2 | 1 | 1520 | 1737 | 1737 | 1.0000 |
| mobile-iphone-12-pro | collection | 1 | 2 | 1548 | 2094 | 2094 | 0.0000 |
| mobile-iphone-12-pro | product | 0 | 3 | — | — | — | — |
| mobile-iphone-12-pro | story | 3 | 0 | 1880 | 3541 | 3541 | 0.0000 |
| desktop-1440 | home | 2 | 1 | 1526 | 2438 | 2438 | 0.8940 |
| desktop-1440 | collection | 2 | 1 | 1492 | 1591 | 1591 | 0.0000 |
| desktop-1440 | product | 3 | 0 | 1400 | 1632 | 1632 | 0.8940 |
| desktop-1440 | story | 3 | 0 | 1256 | 1218 | 1256 | 0.0000 |

## Shift timing and limits

There were 6 raw frame shift entries: 6 occurred before the parent’s first-visible animation-frame proxy, and 0 were not before it. Some entries attribute the shift to the body changing from an 8px inset to zero. This is consistent with a startup style reset; it is not proof of a visitor-visible jump. The proxy is not a compositor presentation timestamp. Raw CLS scores are preserved, and no corrected visible-CLS score is invented.

The presentation proxy is max(host LCP, frame time-origin offset + frame LCP, first visible parent rAF). It is a conservative diagnostic timing, not a replacement CWV metric.

Successful attempts retained 16 HARs and 16 video files. Readiness failures caused the browser runner to crash before complete HAR/video output; an inspected temporary video was undecodable. Request/error auditing therefore covers successful attempts only.

The test driver waits for the iframe, hydration-ready state and decoded images. A timeout does not establish which condition failed. No production diagnosis is inferred from these failures.

Raw artifacts: `/Users/mac/.codex/worktrees/experience-cwv/Baci-app/.superpowers/sdd/2026-10-26-experience-frame-speed/bench/results/2026-10-26T22-38-14.197Z-3ms9aq`. Machine-readable data: [benchmark-now-report.json](./benchmark-now-report.json).

All 16 measured samples exceeded the host-load contamination threshold. The successful HARs contained only the expected pre-bootstrap cart 401 responses and no external hosts. Failed-attempt network coverage is unavailable. A read-only query of the disposable synthetic database confirmed `orders = 0`; no order, payment or publication was performed.
