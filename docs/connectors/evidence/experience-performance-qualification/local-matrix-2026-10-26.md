# Local frame performance matrix — 2026-10-26

This is **diagnostic evidence only** from a synthetic local production fixture. It is not a clean performance qualification or a production Core Web Vitals result. The full matrix ran sequentially in 24 cold Docker/Browsertime samples: four routes × two viewports × three samples, pinned `sitespeedio/sitespeed.io:42.7.0@sha256:3b89ded94e75faf09d34a9f0921d621d470564dcee7c7f51bf2297d701451f71`. Connectivity was native; mobile used iPhone 12 Pro Chrome emulation at 390×844 and desktop was 1440×900. No network throttling was enabled.

Build/source fixture digests:
- Build: `cb28b8d0969a31d7fc5b07ac0e3561b7d42e7a87881767a90b61ec31fe008d92`
- Source: `33713d9bc14e2568e511b118729729a8b5d26744c35b6d3335a6a542aebb240a`

## Results

LCP values are milliseconds. “Frame LCP from host” adds the frame observer’s time-origin offset to its frame LCP. CLS columns are the maximum across the three samples. `Max 1m load/CPU` is the highest one-minute host load average per logical CPU observed during that cell. The diagnostic contamination threshold is 0.8; all cells exceeded it.

| Profile | Route | n | Median host LCP | Median frame LCP | Median frame LCP from host | Max host CLS | Max frame CLS | Max 1m load/CPU |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| mobile-iphone-12-pro | home | 3 | 1172 | 676 | 1063 | 0.000000 | 0.000000 | 2.80 |
| mobile-iphone-12-pro | collection | 3 | 1148 | 616 | 992 | 0.000000 | 0.000000 | 1.80 |
| mobile-iphone-12-pro | product | 3 | 1156 | 588 | 997 | 0.000000 | 0.000000 | 1.54 |
| mobile-iphone-12-pro | story | 3 | 1176 | 516 | 907 | 0.000000 | 0.000000 | 1.42 |
| desktop-1440 | home | 3 | 1188 | 584 | 970 | 0.000000 | 0.000000 | 1.14 |
| desktop-1440 | collection | 3 | 1192 | 536 | 943 | 0.000000 | 0.000000 | 1.03 |
| desktop-1440 | product | 3 | 1324 | 900 | 1576 | 0.000046 | 0.000000 | 6.67 |
| desktop-1440 | story | 3 | 1360 | 1024 | 1505 | 0.000000 | 0.000000 | 9.89 |

## Validation and limitations

- All 24 samples had finite host/frame LCP and CLS metrics, and actual viewport widths matched their expected widths.
- All 24 samples exceeded the load threshold (load average per CPU > 0.8); the peak was 9.89 on a 12-CPU host. Timings are therefore contaminated and must not be used as a pass/fail qualification or as a sub-2-second claim.
- All 24 HARs and videos are retained under the ignored `.superpowers/sdd/2026-10-26-experience-frame-speed/bench/results/2026-10-26T17-46-47.082Z-q5eSQo/` directory.
- HAR inspection found one expected unauthenticated cart read returning HTTP 401 per sample at `/api/storefront/cart?merchantSlug=qa1`; no other HTTP responses >=400 or transport failures were observed. This synthetic unauthenticated gap is not evidence of a cart journey or checkout validation.
- Native connectivity and emulated device dimensions were used; this does not represent Slow 4G or field traffic. There was no CWV pass assertion.

The complete machine-readable sample summary is in [`local-matrix-2026-10-26.json`](./local-matrix-2026-10-26.json).
