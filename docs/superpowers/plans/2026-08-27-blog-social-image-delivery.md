# Blog Social Image Delivery Implementation Plan

**Goal:** Stop normal blog social-preview requests from invoking the dynamic OpenGraph renderer and Supabase while preserving a safe compatibility route for previously cached links.

**Architecture:** `generateMetadata` already owns a cache-tagged blog-post read containing the featured image and its generated variants. Project trusted immutable media into a deterministic, fixed-format CDN URL and publish that asset directly in OpenGraph/Twitter metadata. Keep the dynamic route for historical links, image-less posts, untrusted variants, and formats that cannot be published directly. Every compatibility response is dynamic and strict `no-store`, so branding and blog-enabled changes cannot leave a shared stale card behind.

**Global constraints:**

- Work only in `/Users/mac/Baci-app/.worktrees/blog-og-static-assets` on `codex/blog-og-static-assets`.
- Use TDD: add an exact failing regression first, run it to prove RED, then implement and prove GREEN.
- Do not change `proxy.ts`, migrations, environment files, publishing data, or VPS state.
- Preserve custom-domain and merchant-subdomain URL behavior.
- Never emit `format=auto` in social metadata; use a fixed JPEG/PNG transform for managed OgaBassey CDN images.
- Prefer a trusted immutable generated `landscape_16x9` asset, then the featured image, and fall back to the existing dynamic route when neither candidate can be safely published to social crawlers.
- Keep each touched source/test file at or below 300 lines and maintain one primary utility export per new source file.
- Do not introduce a second database read in metadata generation.

## Task 1: Publish direct immutable social assets from cached post metadata

**Files:**

- Create: `apps/web/src/lib/blog-post-social-image.ts`
- Create: `apps/web/src/lib/blog-post-social-image.test.ts`
- Modify: `apps/web/src/app/(storefront)/[slug]/(blog)/blog/[postSlug]/page.tsx`
- Modify: `apps/web/src/app/(storefront)/[slug]/(blog)/blog/[postSlug]/page.metadata.test.tsx`

**Behavior:**

1. Add a focused projection utility that receives the store URL, post slug, featured image URL, image variants, and optional dimensions.
2. Select `landscape_16x9` first only when it is an immutable generated variant on a trusted media origin; otherwise try `featured_image_url`. Untrusted landscape URLs must not hide a usable original image.
3. For managed OgaBassey CDN image URLs, produce a fixed 1200px fallback-format transform through the existing CDN URL builder. This must unwrap legacy `format=auto` URLs and output JPEG for JPEG/WebP/AVIF sources or PNG for PNG sources.
4. Return direct image metadata (`url`, `width`, `height`, and MIME type when determinable). Landscape variants use 1200x675. A direct original uses positive recorded dimensions when available; otherwise omit dimensions rather than inventing them.
5. If no usable direct image exists, including external AVIF that social crawlers cannot consume consistently, return the current store-aware `/blog/{postSlug}/opengraph-image` compatibility URL with 1200x630 PNG metadata.
6. Use the projection in `generateMetadata` for both OpenGraph and Twitter. It must use only the post already returned by `getRequestScopedBlogPost`.

**Required regressions:**

- The current Pixel-style `https://cdn.ogabassey.com/image/format=auto/core-assets/blog/...-landscape_16x9.jpg` becomes a direct `width=1200,...,format=jpeg` CDN URL for OpenGraph and Twitter, never the dynamic route and never `format=auto`.
- A valid external HTTPS featured image is used directly.
- An untrusted landscape candidate falls through to a valid original, and external AVIF uses the PNG compatibility route.
- Missing/malformed candidates preserve the custom-domain/subdomain compatibility route.
- The utility rejects non-HTTP schemes.

**Validation:** Run the two focused test files and `git diff --check`.

## Task 2: Harden the legacy dynamic image route

**Files:**

- Modify: `apps/web/src/app/(storefront)/[slug]/(blog)/blog/[postSlug]/opengraph-image-response.ts`
- Modify: `apps/web/src/app/(storefront)/[slug]/(blog)/blog/[postSlug]/opengraph-image-response.test.ts`
- Modify: `apps/web/src/app/(storefront)/[slug]/(blog)/blog/[postSlug]/opengraph-image-colors.ts`
- Modify: `apps/web/src/app/(storefront)/[slug]/(blog)/blog/[postSlug]/opengraph-image-colors.test.ts`
- Modify: `apps/web/src/app/(storefront)/[slug]/(blog)/blog/[postSlug]/opengraph-image-markup.tsx`
- Modify: `apps/web/src/app/(storefront)/[slug]/(blog)/blog/[postSlug]/opengraph-image-markup.test.tsx`

**Behavior:**

1. Every compatibility response must remain strictly `no-store`, including successful renders, fallbacks, and the emergency PNG. Direct immutable media in page metadata provides the cacheable fast path without making brand-dependent compatibility cards stale.
2. Add a small color projection that chooses readable foreground text from the configured background (dark foreground for light backgrounds, white foreground for dark backgrounds).
3. Use that foreground in both merchant fallback and primary-card text instead of hardcoded white. Preserve configured accent/primary decoration.
4. Do not broaden remote-image allowlists or weaken SSRF protections.

**Required regressions:**

- Normal, fallback, and emergency compatibility responses remain `no-store`.
- White/light merchant backgrounds produce dark readable text; dark backgrounds produce white text.
- Merchant markup uses the computed foreground, preventing the observed blank white-on-white card.

**Validation:** Run all touched focused tests and `git diff --check`.

## Final verification

1. Run all blog-post OpenGraph and page metadata tests.
2. Run `pnpm turbo lint`, `pnpm turbo typecheck`, and `pnpm turbo test`.
3. Verify no changed source/test file exceeds 300 lines.
4. Run `coderabbit review --agent -t uncommitted` before final commit if the CLI is available; address Critical/High findings.
5. Push `codex/blog-og-static-assets` and create a focused PR against `main` describing the read/render reduction, compatibility behavior, and test evidence.
