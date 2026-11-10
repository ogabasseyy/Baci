# Rebuilt Orbit local benchmark

Fresh anonymous guests; four route families × mobile/desktop × three cold attempts. Actual custom frame measured. Native connectivity; diagnostic lab run, not field CWV or release qualification.

24 attempts: 24 measured, 0 failed. 24 measured samples exceeded the host-load threshold.

| Profile | Route | Measured / 3 | Median host LCP ms | Median frame LCP from navigation ms | Median presentation proxy ms | Max raw CLS | Max post-first-paint CLS |
|---|---|---:|---:|---:|---:|---:|---:|
| mobile-iphone-12-pro | home | 3 | 1172 | 1027 | 1172 | 0.0000 | 0.0000 |
| mobile-iphone-12-pro | collection | 3 | 1188 | 1029 | 1188 | 0.0000 | 0.0000 |
| mobile-iphone-12-pro | product | 3 | 1260 | 1076 | 1264 | 1.0000 | 0.0000 |
| mobile-iphone-12-pro | story | 3 | 1352 | 1163 | 1352 | 0.0000 | 0.0000 |
| desktop-1440 | home | 3 | 1276 | 1399 | 1399 | 0.0000 | 0.0000 |
| desktop-1440 | collection | 3 | 1208 | 1085 | 1208 | 0.0000 | 0.0000 |
| desktop-1440 | product | 3 | 1240 | 1056 | 1260 | 0.0000 | 0.0000 |
| desktop-1440 | story | 3 | 1344 | 1138 | 1344 | 0.0000 | 0.0000 |

The presentation proxy is the maximum of host LCP, child LCP relative to parent navigation, and parent first-visible rAF. It is not a compositor timestamp or a replacement CWV metric. Raw shift entries remain in the JSON. Native first-paint accounting is shown separately; visible shifts remain counted.

Successful HAR audit: 24 files, external hosts [], forbidden order/payment requests 0.

Raw artifacts: `.superpowers/sdd/2026-10-28-experience-release-candidate/cwv-final/2026-10-28T14-50-28.965Z-wtXq2Y`.
