# Inline catalog prices: authoring and rollout contract

Status: implementation in PR #3419; do not enable writer output until the renderer
is deployed and a production article smoke test has passed. A merge alone is not
deployment proof. No existing article is automatically migrated by this change.

## Authoring

Use `{{catalog-price:PRODUCT_UUID}}` in an article text node for a current catalog
price or purchasable price range. For a specific SKU use
`{{catalog-price:PRODUCT_UUID:variant:VARIANT_UUID}}`. Copy verified IDs from the
merchant catalog, never infer IDs from model names. Persist the product in the
article's `blog_post_products` relationships through the existing publishing flow.
Do not embed the reference in titles, descriptions, image attributes, URLs or code.

The server resolves only public products linked to this merchant's article (or
already selected by its public category fallback). It uses existing cached,
hydrated inventory; there is no additional per-reference database query. Eight
product cards remain visible. Referenced linked products beyond that window are
included up to a total of 32 hydrated products per article. References outside
that bound show `Check current price`, not a guessed amount. Keep the total at or
below 32 and validate each resolved value before release.

Unknown/deleted/unlinked products, missing variants or invalid prices show
`Check current price`; confirmed unavailable inventory shows `Currently unavailable`.
SKU variants must belong to the selected product. Condition-offer-specific inline
references are not supported: use the product range or link to its selection page.

Historical prices, launch prices, competitor quotes and genuinely dated price
observations remain literal text with their sources/date. Do not mass-replace
currency amounts. Review existing price mentions individually before conversion.

Do not automatically roll guide years or editorial dates. Queue dated guides for
an actual review of models, alternatives, support and recommendations. Preserve
the original publication date and hardware model years.

## Writer and release rollout

1. Deploy and verify the web renderer in HTML, Markdown and structured articles.
2. Check product and SKU prices, unavailable inventory, currency, cached-price
   invalidation and HTML visible without browser JavaScript.
3. Update the shared VPS writer prompt used by normal, Discover, product-support,
   comparison and brand-desk assignments. Until then, continue dated price
   snapshots; writers must not emit raw references into public articles.
4. Add release validation: every reference must have a valid merchant product
   relationship, a matching SKU when specified, and a resolved preview. Reject
   unresolved references before publication rather than relying on a prompt.
5. Enable reference generation only after both renderer and release checks are
   verified. Migrate reviewed drafts, then existing evergreen guides in batches.

This is a display transformation, not a database rewrite. It does not modify
article titles, stored prose, `datePublished`, `dateModified`, or historical years.
