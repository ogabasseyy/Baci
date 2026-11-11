# Rebuilt Orbit local benchmark

Four route families × mobile/desktop × three cold-browser-cache attempts, reusing one valid synthetic guest session. This excludes first-time anonymous bootstrap and is not directly comparable with the earlier fresh-guest matrix. Actual custom frame measured. Native connectivity; diagnostic lab run, not field CWV or release qualification.

24 attempts: 24 measured, 0 failed. 24 measured samples exceeded the host-load threshold.

| Profile | Route | Measured / 3 | Median host LCP ms | Median frame LCP from navigation ms | Median presentation proxy ms | Max raw CLS | Max post-first-paint CLS |
|---|---|---:|---:|---:|---:|---:|---:|
| mobile-iphone-12-pro | home | 3 | 1160 | 957 | 1160 | 0.0000 | 0.0000 |
| mobile-iphone-12-pro | collection | 3 | 1164 | 971 | 1164 | 0.0000 | 0.0000 |
| mobile-iphone-12-pro | product | 3 | 1196 | 1239 | 1239 | 0.7060 | 0.0000 |
| mobile-iphone-12-pro | story | 3 | 1228 | 928 | 1228 | 0.0000 | 0.0000 |
| desktop-1440 | home | 3 | 1220 | 1069 | 1220 | 0.0000 | 0.0000 |
| desktop-1440 | collection | 3 | 1160 | 1002 | 1160 | 0.0000 | 0.0000 |
| desktop-1440 | product | 3 | 1200 | 1052 | 1216 | 0.8940 | 0.0000 |
| desktop-1440 | story | 3 | 1436 | 1152 | 1436 | 0.0000 | 0.0000 |

The presentation proxy is the maximum of host LCP, child LCP relative to parent navigation, and parent first-visible rAF. It is not a compositor timestamp or a replacement CWV metric. Raw shift entries remain in the JSON. Native first-paint accounting is shown separately; visible shifts remain counted.

Successful HAR audit: 24 files, external hosts [], forbidden order/payment requests 0.

Raw artifacts: `.superpowers/sdd/2026-10-26-experience-frame-speed/bench/results/2026-10-28-orbit-rebuilt-modal`.
