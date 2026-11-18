import { after } from 'next/server';
import {
  purgeCloudflareUrls,
  purgeCloudflareUrlsConfirmed,
} from '@/lib/cloudflare-purge';
import { buildStorefrontBlogPostPurgeUrls } from '@/lib/storefront-blog-post-purge-urls';
import {
  purgeStorefrontHostnameConfirmed,
  scheduleStorefrontHostnamePurge,
} from '@/lib/storefront-product-purge-hostnames';
import {
  buildStorefrontProductPurgeUrls,
  countDistinctProductPurgeEntries,
  PURGE_WHOLE_STOREFRONT_THRESHOLD,
  PURGE_WHOLE_STOREFRONT_URL_THRESHOLD,
  type StorefrontProductPurgeEntry,
} from '@/lib/storefront-product-purge-urls';

export interface StorefrontProductPurgeOptions {
  /** Published blog posts whose related-product rail includes these products. */
  blogPostSlugs?: readonly string[];
  /** Only purge the supplied related blog documents; product URLs were already purged. */
  blogPostsOnly?: boolean;
}

/**
 * Fire-and-forget Cloudflare eviction of a product's affected public URLs.
 *
 * Mirrors the guarded schedule pattern in `cache-revalidation.ts`
 * (`revalidateBlogPosts`): it builds the URLs and schedules the purge inside a
 * try/catch so a purge is ALWAYS survivable (edge caches self-heal on their
 * TTL) and can NEVER throw into the product mutation path that calls it. Uses
 * `after()` when a request context exists (so the purge runs past the response
 * flush) and falls back to a detached promise in cron/worker/test contexts.
 * `purgeCloudflareUrls` itself never throws.
 *
 * `identifier` is the merchant slug (e.g. `ogabassey`) or one of its custom
 * hostnames. Storefronts without a public cache policy resolve to no hostnames
 * (empty URL list) and this is a silent no-op; so is a missing identifier or an
 * empty entry list.
 */
type ProductPurgePlan =
  | { kind: 'noop' }
  | { kind: 'hostname'; identifier: string }
  | { kind: 'urls'; urls: string[] };

function resolveProductPurgePlan(
  identifier: string | null | undefined,
  entries: readonly StorefrontProductPurgeEntry[],
  options: StorefrontProductPurgeOptions = {}
): ProductPurgePlan {
  const normalizedIdentifier = identifier?.trim();
  if (!normalizedIdentifier || entries.length === 0) {
    return { kind: 'noop' };
  }

  if (
    !options.blogPostsOnly &&
    countDistinctProductPurgeEntries(entries) > PURGE_WHOLE_STOREFRONT_THRESHOLD
  ) {
    return { kind: 'hostname', identifier: normalizedIdentifier };
  }

  const urls = options.blogPostsOnly
    ? buildStorefrontBlogPostPurgeUrls(
        [normalizedIdentifier],
        options.blogPostSlugs ?? []
      )
    : buildStorefrontProductPurgeUrls(
        [normalizedIdentifier],
        entries,
        options.blogPostSlugs
      );
  if (urls.length === 0) {
    return { kind: 'noop' };
  }

  if (urls.length > PURGE_WHOLE_STOREFRONT_URL_THRESHOLD) {
    return { kind: 'hostname', identifier: normalizedIdentifier };
  }

  return { kind: 'urls', urls };
}

/**
 * Awaited, confirmed Cloudflare eviction for background workers (such as quiz
 * finalization) that must not advance a sweep baseline unless edge eviction
 * is confirmed.
 */
export async function purgeStorefrontProductConfirmed(
  identifier: string | null | undefined,
  entries: readonly StorefrontProductPurgeEntry[],
  options: StorefrontProductPurgeOptions = {}
): Promise<boolean> {
  try {
    const plan = resolveProductPurgePlan(identifier, entries, options);
    if (plan.kind === 'noop') {
      return true;
    }
    if (plan.kind === 'hostname') {
      return await purgeStorefrontHostnameConfirmed(plan.identifier);
    }
    const confirmation = await purgeCloudflareUrlsConfirmed(plan.urls);
    return confirmation.ok === true;
  } catch (error) {
    console.warn('Confirmed Cloudflare product purge failed', {
      identifier,
      entryCount: entries.length,
      error,
    });
    return false;
  }
}

export function scheduleStorefrontProductPurge(
  identifier: string | null | undefined,
  entries: readonly StorefrontProductPurgeEntry[],
  options: StorefrontProductPurgeOptions = {}
): void {
  try {
    const plan = resolveProductPurgePlan(identifier, entries, options);
    if (plan.kind === 'noop') {
      return;
    }

    if (plan.kind === 'hostname') {
      scheduleStorefrontHostnamePurge(plan.identifier);
      return;
    }

    try {
      after(() => purgeCloudflareUrls(plan.urls));
    } catch {
      // Not inside a request scope (standalone worker / test) — detach instead.
      void purgeCloudflareUrls(plan.urls);
    }
  } catch (error) {
    console.warn('Skipped Cloudflare product purge scheduling', {
      identifier,
      entryCount: entries.length,
      error,
    });
  }
}
