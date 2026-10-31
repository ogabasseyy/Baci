# Approved IMEI retail reductions — 30 October 2026

Owner approved the displayed preview, with four explicit price protections: Stolen Check NGN700, SIM Lock NGN500, Apple Part Number NGN700, and Serial Info NGN200. Quick ID and Find My Check remain NGN300. Exactly 25 public prices decrease; no price increases. The 20 unverified Petrock candidates and all unlocking remain disabled and unchanged.

These are fixed retail amounts, not live FX conversion. The preview used the previous NGN1,575/USD reference, 500% markup below USD1, 100% from USD1 to below USD5, and NGN300 minimum / upward NGN100 rounding, followed by the approved exceptions. Higher bands were 50% below USD10, 25% below USD100, 15% below USD200 and 10% below USD300. No mapped diagnostic requires a USD300+ rule. Supplier funding rates and fees are not represented as guaranteed by these calculations.

| Service | Previous NGN | Approved NGN |
|---|---:|---:|
| Non-Active Status PRO | 700 | 400 |
| Apple Basic Info | 800 | 500 |
| Apple Part Number | 700 | 700 |
| Quick ID | 300 | 300 |
| Stolen Check | 700 | 700 |
| Stolen Check PRO | 2,000 | 1,200 |
| Network Check | 1,000 | 600 |
| Network + Find My | 1,300 | 800 |
| Demo Unit Check | 3,300 | 1,900 |
| eSIM Compatibility | 700 | 400 |
| Full Report | 1,500 | 1,000 |
| GSX Premium Report | 32,700 | 6,300 |
| Repairs & Coverage | 19,600 | 3,800 |
| Find My Check | 300 | 300 |
| iCloud Clean/Lost | 500 | 300 |
| iCloud Lost Check PRO | 3,500 | 2,100 |
| Knox Guard | 5,000 | 2,900 |
| Mac iCloud Lock | 3,300 | 1,900 |
| MDM Lock Check | 5,000 | 2,900 |
| Mi Lock Check | 1,500 | 1,000 |
| Mi Lost Check PRO | 8,000 | 4,800 |
| Oppo/Realme Info | 3,300 | 1,900 |
| Pixel Info | 2,000 | 1,200 |
| Repair Eligibility | 2,300 | 1,400 |
| Replacement History | 11,500 | 6,700 |
| Samsung Info | 1,000 | 600 |
| Samsung Info PRO | 1,500 | 1,000 |
| Serial Info | 200 | 200 |
| SIM Lock | 500 | 500 |
| Sold By & Country | 29,400 | 5,700 |
| Tecno/Infinix Info | 500 | 300 |

## Release and compatibility

Apply the append-only `20261030181744_imei_approved_price_reductions.sql` through the normal production migration/release flow and publish the same-head application. It copies the latest authenticated gateway and changes only fixed insertion prices; ownership, signing, cancellation, refunds and grants stay intact. Existing lookups retain their original stored amounts, so old-price replay/refund is unaffected. The database rejects old higher amounts for new requests once the migration lands; until new web functions publish, an old deployment can fail closed before debit rather than overcharge. Do not independently deploy stale application code.

Web and mobile source consume the shared catalog. Existing native binaries keep their embedded display prices until an app update; use the web release first and ship matching native prices before claiming native price parity. No arbitrary live Supabase catalog edit changes the displayed fixed retail prices.

The isolated SQL suite exercises every public amount, rejects off-by-one/old higher prices, verifies duplicate debit/refund protection, refunds a real pre-migration higher-price debit, and re-runs pre-submit cancellation after the price-only gateway replacement. Fixtures must never run in production.
