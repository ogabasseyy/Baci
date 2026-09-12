# Ogabassey Codex Content Agents

Last updated: 2026-08-31.

## Runtime

The active content runner lives on the VPS at
`/home/bassey/ogabassey-agents`. It uses the logged-in Codex CLI session for
draft writing and image generation. It does not use an OpenAI API key.

Primary runner:

```bash
scripts/run_codex_content_agent.sh --task news|comparison|product_support|repair_support
```

Compatibility wrapper:

```bash
scripts/run_codex_blog_agent.sh "query"
```

The wrapper delegates to `run_codex_content_agent.sh --task news` so the
existing daily cron keeps working.

## Task Types

| Task | Purpose | Publish state |
| --- | --- | --- |
| `news` | recent gadget, phone, and laptop news | `draft` |
| `comparison` | catalog-grounded product comparisons | `draft` |
| `product_support` | buyer/support posts for latest catalog devices | `draft` |
| `repair_support` | normal blog posts for repair intent, category `Repairs` | `draft` |

Generation still writes content as `draft` first. Normal product-support,
comparison, and repair-support drafts may then enter the receipt-backed
editorial release controller after the review window and release guards pass;
Discover/news drafts remain human-review only. Repair-support articles use the
normal `/blog/<post-slug>` route and link to `/repairs` and `/repair`; do not
create `/repair/blog` or `/repairs/blog`.

## Current release cadence

The production VPS controller was verified on 2026-08-30. It runs five Lagos
release slots per day (`09:00`, `11:00`, `13:00`, `15:00`, `17:00`) and claims at
most one eligible draft per invocation. A 12-hour receipt window, semantic
duplicate checks, product-state checks, preflight/publish guards, conditional
database claims, and flock locks remain in force. The cadence is a ceiling,
not a promise that five posts will publish: a slot can be empty when no draft
passes every gate.

The current generation crons are independently bounded: product-support
coverage targets up to five guarded drafts per day, while Discover targets up
to two review-only drafts per day. Track `eligible_count`,
`scheduled_count`, and rejection reasons in the release audit before changing
these limits.

## Product Links

Product-support and comparison drafts can include `target_product_ids`. The VPS
publisher writes those IDs to `public.blog_post_products` after inserting the
draft. BlogSnippet reads that table first, then falls back to semantic matching.

### Live commerce data contract

The product rail is the live commerce surface. It reads the linked product's
current price, sale price, stock quantity, and managed-stock state from the
catalog when the article is rendered; product cache invalidation is keyed by
the merchant's `products-{merchant_id}` tag. The price or availability written
inside an article body is an editorial snapshot, not a promise that the value
will remain current.

Agents must therefore:

- emit `target_product_ids` for every product the draft presents as a product
  recommendation or comparison target;
- describe body prices as checked at the supplied catalog-sync/publication
  time and link readers to the live product card for the current offer;
- never invent a price or availability value when the candidate does not
  provide one; and
- leave stock decisions to the storefront rail, which applies the shared
  managed/unmanaged inventory rules and shows an unavailable state when a
  managed product reaches effective stock zero.

The retired ADK compatibility path (`agents/content_writer.yaml` and
`agents/save_tool.py`) is not a production commercial lane because its
`save_draft` contract predates explicit product-link persistence. Use
`scripts/run_codex_content_agent.sh` for product-support and comparison work;
do not re-enable the legacy cron without first giving it the same target-ID
and live-rail contract.

Deployment order:

1. Deploy the Baci migration that creates `public.blog_post_products`.
2. Deploy the BlogSnippet explicit-link reader.
3. Enable publisher writes on the VPS.
4. Only then enable non-news crons.

## Manual Verification

Use dry-run mode before enabling a task cron:

```bash
cd /home/bassey/ogabassey-agents
CODEX_PUBLISH_DRY_RUN=1 scripts/run_codex_content_agent.sh --task comparison
CODEX_PUBLISH_DRY_RUN=1 scripts/run_codex_content_agent.sh --task product_support
CODEX_PUBLISH_DRY_RUN=1 scripts/run_codex_content_agent.sh --task repair_support
```

For each run, inspect:

- `data/codex-runs/<run-id>/candidate.json`
- `data/codex-runs/<run-id>/draft.json`
- `data/codex-runs/<run-id>/codex.log`
- Generated image files and CDN URLs

Codex image generation writes to `~/.codex/generated_images/<session-id>` on the
VPS. The Python harvester copies those generated PNGs into the run directory,
then creates CDN variants. Prompts should not ask Codex to shell-copy generated
images because the VPS shell sandbox can fail even when image generation itself
succeeds.

Generated images must include IPTC/XMP
`XMP-iptcExt:DigitalSourceType=https://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia`
before CDN upload.

## Cron Policy

The VPS uses the product-support coverage batch and Discover batch as the
active generation lanes. Comparison authority lanes are deliberately narrower.
Do not enable a new lane solely to fill a quota: run a dry run, inspect the
candidate, receipt, preflight, duplicate report, and product links, then let
the release controller decide when a normal draft is safe to schedule.
