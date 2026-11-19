# Petrock scoped activation evidence — 2026-10-30

Historical pre-probe snapshot: later authorized captures and their restricted
bindings are documented in [the eSIM addendum](petrock-esim-capture-20261030.md),
[part-number addendum](petrock-part-number-capture-20261030.md), and
[SIM-lock capture disposition](petrock-additional-captures-20261030.md).
The zero-addition result below predates those probes; the current release has
two verified additions and 20 remaining dark candidates.

No additional customer services qualify for activation from the checked-in response
evidence. The 22 dark info-tier candidates contain **15 catalog-matched candidates,
7 unmatched candidates, and 0 additional verified bindings**. All remain dark.
The four existing bindings (`knoxGuard`, `pixel`, `samsung`, `simLock`) are preserved.
No customer NGN price, supplier baseline, rollout flag, production configuration,
or provider order was changed by this work. No network requests were made.

## Available response evidence

The captured successful product **1954** replay reports device model, color,
storage and Find My iPhone. It does not report a model-number field, serial,
warranty, finance, replacement history or the other candidate-specific fields.
It is not any of the 15 candidate product IDs. Its successful iPhone IMEI probe
does not establish serial-input or other-device coverage. Product **1955** returned
`Unable to check blacklist status.` with terminal rejection; it establishes no
positive report coverage. These outcomes are recorded in
[the current contract](petrock-current-contract.md#live-paid-probes--2026-10-25).

Catalog descriptions, matching product names and synthetic parser examples do not
constitute captured supplier output. Existing bindings are preserved as requested;
this report does not upgrade their completion-evidence status.

## Evidence still missing

Each matched candidate needs a provenance-reviewed successful replay from its
**own product**, demonstrating all fields below and its advertised device/input
scope. Every field listed remains unproven for that candidate by actual captured
responses. The catalog alone establishes none of these output promises.

| Tier | Candidate product | Required captured fields |
| --- | --- | --- |
| `esimCompatibility` | 1941 | device, modelNumber, esimCompatibility |
| `replacementStatus` | 1966 | device, modelNumber, replacementHistory |
| `applePartNumber` | 1963 | device, modelNumber, partNumber |
| `attFinance` | 1957 | device, modelNumber, blacklistStatus, carrier, financeStatus |
| `tmobileFinance` | 746 | device, modelNumber, blacklistStatus, carrier, financeStatus |
| `verizonFinance` | 1959 | device, modelNumber, blacklistStatus, carrier, financeStatus |
| `oneplusPremium` | 738 | device, modelNumber |
| `transsionPremium` | 728 | device, modelNumber |
| `macInfo` | 698 | device, modelNumber, serialNumber, wifiMac |
| `applePremium` | 666 | device, modelNumber, serialNumber, warranty, replacementHistory |
| `applePremiumMax` | 1943 | device, modelNumber, serialNumber, warranty, gsxCoverage, repairHistory, replacementHistory |
| `tracfoneFinance` | 743 | device, modelNumber, blacklistStatus, carrier, financeStatus |
| `japanDocomo` | 732 | device, modelNumber, carrier, financeStatus |
| `japanSoftbank` | 733 | device, modelNumber, carrier, financeStatus |
| `japanKddi` | 730 | device, modelNumber, carrier, financeStatus |

The seven unmatched candidates also need an appropriate product before response
verification can begin:

| Tier | Missing catalog match |
| --- | --- |
| `refurbishedStatus` | No current refurbished-only product |
| `knoxEnrollment` | Product 700 advertises Knox Guard enrollment, not verified Knox Mobile Enrollment/MDM |
| `samsungSoldBy` | Product 1990 advertises country/date, not original seller business |
| `macPhotoReport` | Product 713 is Find My Mac, not a photo report |
| `xfinityFinance` | Product 2015 advertises unlock eligibility, not verified finance balance |
| `japanRakuten` | No verified Rakuten product |
| `japanNetwork` | No verified generic Japan network product |

## Offline verification harness and regression evidence

`apps/web/src/lib/imei-providers/petrock/petrock-info-replay-review.ts` exports
`inspectPetrockInfoCandidateReplay(tierKey, { productId, status, replay })`.
It can inspect supplied candidate replays without placing or polling an order.
It reports missing promised fields, rejects wrong-product and non-success output,
and excludes blank/placeholder values. It always retains
`reviewed_capture_required` and `fixtureVerified: false`: parser coverage cannot
establish provenance, approve a binding, or activate any service.

The regression suite proves all 22 candidates stay absent from the shared public
selector and resolve to no provider even with global enablement, async support
and every candidate explicitly allowlisted, across all advertised device
categories. It also tests empty reports, the unrelated captured 1954 replay,
pending/rejected orders, placeholder values and a synthetic complete report.
The synthetic example remains unverified after satisfying parser field coverage.

Validation: **6 targeted test files / 107 tests passed**, covering the replay
harness, candidates, existing curated bindings, supplier check catalog, captured
live-response regressions and replay parser. Biome passed for both added source
and test files. These are local targeted results; they establish no live provider,
production activation or complete-monorepo pass.
