# Rebuilt Orbit local benchmark

Fresh anonymous guests; four route families × mobile/desktop × three cold attempts. Actual custom frame measured. Native connectivity; diagnostic lab run, not field CWV or release qualification.

24 attempts: 24 measured, 0 failed. 24 measured samples exceeded the host-load threshold.

| Profile | Route | Measured / 3 | Median host LCP ms | Median frame LCP from navigation ms | Median presentation proxy ms | Max raw CLS | Max post-first-paint CLS |
|---|---|---:|---:|---:|---:|---:|---:|
| mobile-iphone-12-pro | home | 3 | 1468 | 1308 | 1468 | 0.0000 | 0.0000 |
| mobile-iphone-12-pro | collection | 3 | 1504 | 1541 | 1541 | 0.0000 | 0.0000 |
| mobile-iphone-12-pro | product | 3 | 1300 | 1225 | 1300 | 1.0000 | 0.0000 |
| mobile-iphone-12-pro | story | 3 | 1264 | 1042 | 1264 | 0.0000 | 0.0000 |
| desktop-1440 | home | 3 | 1232 | 922 | 1232 | 0.0000 | 0.0000 |
| desktop-1440 | collection | 3 | 1200 | 921 | 1200 | 0.0000 | 0.0000 |
| desktop-1440 | product | 3 | 1476 | 1654 | 1654 | 0.8940 | 0.0000 |
| desktop-1440 | story | 3 | 1468 | 1540 | 1540 | 0.0000 | 0.0000 |

The presentation proxy is the maximum of host LCP, child LCP relative to parent navigation, and parent first-visible rAF. It is not a compositor timestamp or a replacement CWV metric. Raw shift entries remain in the JSON. Native first-paint accounting is shown separately; visible shifts remain counted.

Successful HAR audit: 24 files, external hosts [], forbidden order/payment requests 0.

Raw artifacts: `.superpowers/sdd/2026-10-28-experience-release-candidate/cwv-fresh-full/2026-10-28T13-36-24.922Z-QNPy1D`.
