# Catalog maintenance receipt — 25 October 2026

The owner-requested six-product correction batch was applied to the Ogabassey merchant's catalog through connected operator maintenance, independently of deploying the application branch. No privileged runtime client or new bypass was introduced. The SQL generator uses an exact merchant/product scope and before-state guards; all twelve row-count assertions succeeded and the transaction committed. Post-write reads matched every planned specification and researched-key-spec field for all six records. No statement changes price, stock, condition or schema.

Public HTTP verification was performed 21:23:05–21:23:16 UTC with the truthful `Baci-Release-Verification/1.0` user agent. All six pages returned 200 and current visible text showed the intended corrections:

| Public page | Verified output |
| --- | --- |
| [JBL Go 4](https://ogabassey.com/audio/jbl-go-4) | 850mAh capacity and corrected 94.3mm dimension; old 2800mAh absent. [JBL source](https://www.jbl.cl/on/demandware.static/-/Sites-masterCatalog_Harman/default/dwec5ad861/pdfs/JBL%20Go%204_%20Specsheet_EN.pdf). |
| [JBL Go 3](https://ogabassey.com/audio/jbl-go-3) | Unsupported 2700mAh claim removed; no replacement capacity invented. |
| [16-inch MacBook Pro M3 Max](https://ogabassey.com/laptops/macbook-pro-16-inch-m3-max-2023) | 16.2-inch/3456-pixel display facts present; old 14.2-inch/3024-pixel/1620g claims absent. Researched power and model dimensions also reconciled against [Apple](https://support.apple.com/en-us/117737). |
| [16-inch MacBook Pro M2 Max](https://ogabassey.com/laptops/macbook-pro-16-inch-m2-max-2023) | M2 Max identity retained; unrelated M3 Pro claims absent. [Apple model reference](https://support.apple.com/en-us/111838). |
| [AirPods 4](https://ogabassey.com/earbuds/airpods-4) | Explicit per-earbud/case weights (4.3g/32.3g); unverified 380mAh removed. [Apple source](https://support.apple.com/en-us/121203). |
| [AirPods 4 ANC](https://ogabassey.com/earbuds/apple-airpods-4-anc) | Explicit per-earbud/case weights (4.3g/34.7g); unverified 380mAh removed. [Apple source](https://support.apple.com/en-us/121204). |

Public HTML and machine-readable check results are saved alongside the original audit artifacts in the chat's `seo-aeo-audits-20261025` deliverable directory, named `catalog-live-*.html` and `catalog-live-verification.json`. The tracked public before-image and deterministic transform preserve the correction basis. Manufacturer model facts are not a physical inspection of a unit or confirmation of supplied accessories. The M2 Max listing's 512GB configuration still needs actual model/storage verification; this maintenance did not alter sale variants or pretend that configuration was manufacturer-verified.

This receipt proves these bounded database changes and public page observations. It does not prove application-branch deployment, provider recrawl, Merchant Center acceptance, indexed snippet changes or ranking gains.
