import type { SupabaseClient } from '@supabase/supabase-js';
import { revalidateBlogPosts } from '@/lib/cache-revalidation';
import { purgeCloudflareUrlsConfirmed } from '@/lib/cloudflare-purge';
import {
  getMerchantBlogRevalidationContext,
  type MerchantBlogRevalidationContext,
} from '@/lib/get-merchant-blog-cache-identifiers';
import { schedulePrewarmBlogImageTransforms } from '@/lib/ogabassey-blog-image-prewarm';
import { generateSlug } from '@/lib/seo-utils';
import { buildStorefrontBlogPurgeUrls } from '@/lib/storefront-purge-urls';
import { dispatchConfiguredZohoBlogCampaign } from '@/lib/zoho-blog-campaign-server';
import type { ScheduledPost } from './publish-scheduled-posts-eligibility';

export type MerchantScheduledPosts = {
  categories: Set<string>;
  featuredImageUrls: string[];
  listingPages: number[];
  postSlugs: string[];
};

export type RevalidationResult = {
  blogRevalidationByMerchant: Map<string, MerchantBlogRevalidationContext>;
  failedMerchants: string[];
};

function chunkArray<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function resolveStandaloneRevalidationUrl(): string {
  const rawBaseUrl =
    process.env.BACI_WEB_BASE_URL?.trim() ||
    process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (!rawBaseUrl) {
    throw new Error(
      'BACI_WEB_BASE_URL or NEXT_PUBLIC_APP_URL is required for standalone blog revalidation'
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(rawBaseUrl);
  } catch {
    throw new Error('Standalone revalidation app URL is invalid');
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
    throw new Error(
      'Standalone revalidation app URL must be credential-free HTTPS'
    );
  }
  return `${parsed.origin}/api/internal/revalidate-blog`;
}

export function groupPostsByMerchant(scheduledPosts: ScheduledPost[]) {
  const postsByMerchant = new Map<string, MerchantScheduledPosts>();

  for (const post of scheduledPosts) {
    const merchantPosts = postsByMerchant.get(post.merchant_id) ?? {
      categories: new Set<string>(),
      featuredImageUrls: [],
      listingPages: [1],
      postSlugs: [],
    };

    if (post.slug) {
      merchantPosts.postSlugs.push(post.slug);
    }
    if (post.category) {
      merchantPosts.categories.add(post.category);
    }
    if (post.featured_image_url) {
      merchantPosts.featuredImageUrls.push(post.featured_image_url);
    }

    postsByMerchant.set(post.merchant_id, merchantPosts);
  }

  return postsByMerchant;
}

export async function revalidateScheduledPostsByMerchant(
  supabase: SupabaseClient,
  postsByMerchant: Map<string, MerchantScheduledPosts>
): Promise<RevalidationResult> {
  const failedMerchants: string[] = [];
  const blogRevalidationByMerchant = new Map<
    string,
    MerchantBlogRevalidationContext
  >();

  for (const [merchantId, merchantPosts] of postsByMerchant) {
    try {
      const blogRevalidation = await getMerchantBlogRevalidationContext(
        supabase,
        merchantId
      );
      let standaloneStatus: 'none' | 'purged' | 'purge-failed' = 'none';
      const runStandaloneRevalidation = async (): Promise<
        'purged' | 'purge-failed'
      > => {
        // Standalone VPS workers run outside Next.js's static generation store:
        // trigger the authenticated /api/internal/revalidate-blog endpoint so
        // Next.js 'use cache' entries revalidate, then purge Cloudflare edge URLs.
        const internalSecret = process.env.INTERNAL_API_SECRET?.trim();
        if (!internalSecret) {
          throw new Error(
            'INTERNAL_API_SECRET is required for standalone blog revalidation'
          );
        }
        const internalUrl = resolveStandaloneRevalidationUrl();
        const identifierChunks = chunkArray(blogRevalidation.identifiers, 20);
        const categoryChunks = chunkArray(
          Array.from(merchantPosts.categories),
          50
        );
        const pageChunks = chunkArray(merchantPosts.listingPages, 50);
        const slugChunks = chunkArray(merchantPosts.postSlugs, 250);
        if (identifierChunks.length > 0 && slugChunks.length > 0) {
          const batchCount = Math.max(
            identifierChunks.length,
            categoryChunks.length,
            pageChunks.length,
            slugChunks.length
          );
          for (let i = 0; i < batchCount; i++) {
            const listingCategories = categoryChunks[i];
            const listingPages = pageChunks[i];
            const internalResponse = await fetch(internalUrl, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${internalSecret}`,
              },
              body: JSON.stringify({
                merchantId,
                identifiers: identifierChunks[i] ?? [
                  blogRevalidation.identifiers[0],
                ],
                canonicalMerchantSlug: blogRevalidation.canonicalMerchantSlug,
                ...(listingCategories?.length ? { listingCategories } : {}),
                ...(listingPages?.length ? { listingPages } : {}),
                postSlugs: slugChunks[i] ?? [merchantPosts.postSlugs[0]],
              }),
              signal: AbortSignal.timeout(15_000),
            });
            if (!internalResponse.ok) {
              throw new Error(
                `Internal blog revalidation failed with status ${internalResponse.status}`
              );
            }
          }
        }

        const purgeIdentifiers = Array.from(
          new Set(
            [
              ...blogRevalidation.identifiers,
              blogRevalidation.canonicalMerchantSlug,
            ]
              .map((id) => id?.trim().toLowerCase())
              .filter((id): id is string => Boolean(id))
          )
        );
        const purgeCategorySlugs = Array.from(
          new Set(
            Array.from(merchantPosts.categories)
              .map((category) => (category ? generateSlug(category) : ''))
              .filter((slug): slug is string => Boolean(slug))
          )
        );
        const purgeSlugs = Array.from(
          new Set(
            merchantPosts.postSlugs
              .map((slug) => slug?.trim())
              .filter((slug): slug is string => Boolean(slug))
          )
        );
        const purgeResult = await purgeCloudflareUrlsConfirmed(
          buildStorefrontBlogPurgeUrls(
            purgeIdentifiers,
            purgeSlugs,
            purgeCategorySlugs
          )
        );
        if (!purgeResult.ok) {
          console.warn(
            'Cron Warning: Cloudflare blog edge purge did not complete for merchant %s: %s',
            merchantId,
            purgeResult.reason ?? 'unknown'
          );
        }
        return purgeResult.ok ? 'purged' : 'purge-failed';
      };

      if (process.env.VPS_WORKER === '1') {
        standaloneStatus = await runStandaloneRevalidation();
      } else {
        try {
          revalidateBlogPosts({
            merchantId,
            identifiers: blogRevalidation.identifiers,
            canonicalMerchantSlug: blogRevalidation.canonicalMerchantSlug,
            listingCategories: Array.from(merchantPosts.categories),
            listingPages: merchantPosts.listingPages,
            postSlugs: merchantPosts.postSlugs,
          });
        } catch (nextRevalError) {
          const msg =
            nextRevalError instanceof Error
              ? nextRevalError.message
              : String(nextRevalError);
          if (!msg.includes('static generation store')) {
            throw nextRevalError;
          }
          standaloneStatus = await runStandaloneRevalidation();
        }
      }
      blogRevalidationByMerchant.set(merchantId, blogRevalidation);
      schedulePrewarmBlogImageTransforms(merchantPosts.featuredImageUrls);
      console.log(
        standaloneStatus === 'purged'
          ? `🔄 Cron: Revalidated and purged Cloudflare blog edge cache for merchant ${merchantId} across ${merchantPosts.postSlugs.length} posts (standalone worker)`
          : standaloneStatus === 'purge-failed'
            ? `🔄 Cron: Revalidated blog cache for merchant ${merchantId} across ${merchantPosts.postSlugs.length} posts (standalone worker; Cloudflare edge purge failed)`
            : `🔄 Cron: Revalidated blog cache for merchant ${merchantId} across ${merchantPosts.postSlugs.length} posts`
      );
    } catch (revalError) {
      console.error(
        'Cron Error: Revalidation failed for merchant %s:',
        merchantId,
        revalError
      );
      failedMerchants.push(merchantId);
    }
  }

  return { blogRevalidationByMerchant, failedMerchants };
}

export async function dispatchScheduledPostZohoCampaigns(
  supabase: SupabaseClient,
  eligiblePosts: ScheduledPost[],
  blogRevalidationByMerchant: Map<string, MerchantBlogRevalidationContext>
) {
  const dispatchablePosts = eligiblePosts.filter((post) =>
    blogRevalidationByMerchant.has(post.merchant_id)
  );
  const skippedCampaignResults = eligiblePosts
    .filter((post) => !blogRevalidationByMerchant.has(post.merchant_id))
    .map((post) => ({
      postId: post.id,
      reason:
        'Skipped Zoho Campaigns dispatch because blog revalidation failed for this merchant',
      status: 'skipped' as const,
    }));

  return [
    ...(await Promise.all(
      dispatchablePosts.map((post) =>
        dispatchConfiguredZohoBlogCampaign({
          context: blogRevalidationByMerchant.get(post.merchant_id),
          post,
          supabase,
        })
      )
    )),
    ...skippedCampaignResults,
  ];
}
