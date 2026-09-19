# Feed Variant Consistency

## Scope

- Facebook SKU-matrix products emit variant IDs grouped by product ID.
- Both builders use the same variant renderer for price, condition, description,
  colour image, and the variant-selected landing URL.
- Open Box deliberately maps to Refurbished; that policy is unchanged.
- Missing conditions are excluded rather than silently advertised as New.
- Variant compare-at prices and identifiers are not borrowed from the parent.
- Identifiers that are unknown are omitted, without asserting that none exist.
- A colour variant needs an exact or same-colour verified manifest image. An
  unrelated family image is not substituted.
- Google's disabled-variant rollout mode keeps its product ID but now links to
  the exact selected SKU and uses that SKU's details.
- Facebook browser, server and native commerce events use product-group matching
  for the parent product IDs already present in analytics.

No inventory prices, quantities or publication states were changed. The owner
confirmed Honor Pad X7 is New; its missing database condition was updated to
`new` separately from this code change.

## Read-Only Production Check

On 2026-09-11, iPhone 16 had 65 variants, all with conditions and matching
colour-scoped verified images. A fresh database snapshot produced 65 rows in
each local builder, all with variant deep links. New 128GB prices were
NGN 1,032,000 for White/Ultramarine and NGN 1,092,000 for Black/Pink/Teal.
The NGN 891,000 Used price remains valid; it is no longer the only Facebook row.

One active legacy product had a missing condition: Honor Pad X7 128GB + 4GB
(with Case), ID a1b14320-ec77-4eaf-9ec1-f782c311999a. Following owner
confirmation, a scoped update returned condition `new` on 2026-09-11.

## Release Checks

This is not a production deployment. Before activation:

1. Check full-catalog image/condition coverage, not just the iPhone example.
2. Ingest and inspect the new Facebook catalog rows and item groups.
3. Coordinate the web/CAPI and mobile release; older mobile binaries still emit
   the previous native backup matching type. Check existing ad-set product-ID
   filters before removing the old family items from the catalog.
4. Verify Meta catalog match rates and variant landing pages after ingestion.
5. Verify Google diagnostics for identifiers requiring supplier confirmation.

## Review Disposition

CodeRabbit's suggestion to restore missing-condition-to-New fallback was not
applied: it would reintroduce the exact mislabelling risk being fixed. The live
Honor tablet demonstrates why guessing New is unsafe.

Purchase-helper and combined-hook coverage were extended. Identifier metadata
was removed from variant query parameters. Feed stock/title constants were
consolidated. Existing integration tests cover Google availability, family-row
mode, and simple-item discounts/identifiers. Relative-import style suggestions
were left unchanged to match neighbouring modules. The main Google builder is
within the 300-line limit after extracting its types and rendering helpers.

## Validation

Lint and typecheck pass. The focused feed/tracking run passed 318 tests; the
public XML route integration and variant renderer also passed after correcting
an old fixture that omitted condition. Both mobile suites passed (admin: 4,288
tests; storefront: 5,847 tests). The full web run passed 5,387 files but was not
green: its two feed failures passed on rerun, while the unrelated Cloudflare
process-isolation test rejects an uncommitted tooling worktree. Its clean-tree
safety check was not changed. Repeat the full gate from a clean commit before
release.

## Sources

- [Google variant IDs](https://support.google.com/merchants/answer/6324405?hl=en)
- [Google product identifiers](https://support.google.com/merchants/answer/160161?hl=en)
- [Meta server-side event schema](https://github.com/facebookincubator/Facebook-Server-Side-API-Swagger/blob/main/server-side-api.yaml)
