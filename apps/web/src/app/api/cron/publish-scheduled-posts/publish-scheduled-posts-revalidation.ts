import type { SupabaseClient } from '@supabase/supabase-js';
import { revalidateBlogPosts } from '@/lib/cache-revalidation';
import { purgeCloudflareUrls } from '@/lib/cloudflare-purge';
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
      blogRevalidationByMerchant.set(merchantId, blogRevalidation);
      let edgePurgeOnly = false;
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
        // Standalone VPS workers run outside Next.js's static generation store;
        // still schedule the Cloudflare edge purge for the published blog URLs.
        const msg =
          nextRevalError instanceof Error
            ? nextRevalError.message
            : String(nextRevalError);
        const isOutsideRequestContext =
          msg.includes('static generation store') || msg.includes('Invariant:');
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
        await purgeCloudflareUrls(
          buildStorefrontBlogPurgeUrls(
            purgeIdentifiers,
            purgeSlugs,
            purgeCategorySlugs
          )
        );
        if (!isOutsideRequestContext) {
          throw nextRevalError;
        }
        edgePurgeOnly = true;
      }
      schedulePrewarmBlogImageTransforms(merchantPosts.featuredImageUrls);
      console.log(
        edgePurgeOnly
          ? `🔄 Cron: Purged Cloudflare blog edge cache for merchant ${merchantId} across ${merchantPosts.postSlugs.length} posts (standalone worker)`
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
