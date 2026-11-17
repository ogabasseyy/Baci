import type { SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { BLOG_LISTING_PAGE_SIZE } from '@/lib/blog-listing-page-size';
import {
  getEligibleScheduledPosts,
  type ScheduledPost,
} from './publish-scheduled-posts-eligibility';
import {
  dispatchScheduledPostZohoCampaigns,
  groupPostsByMerchant,
  revalidateScheduledPostsByMerchant,
} from './publish-scheduled-posts-revalidation';
import { recoverMerchantBlogReleaseReservations } from './recover-abandoned-reservations';

export async function publishScheduledPosts(supabase: SupabaseClient) {
  try {
    const now = new Date().toISOString();

    console.log(`🚀 Cron: Checking for scheduled posts to publish at ${now}`);

    const { data: scheduledPosts, error: fetchError } = await supabase
      .from('blog_posts')
      .select(
        'id, title, slug, excerpt, merchant_id, category, published_at, featured_image_url, featured_image_width, featured_image_height, featured_image_variants'
      )
      .eq('status', 'scheduled')
      .lte('published_at', now);

    if (fetchError) {
      console.error('Cron Error: Failed to fetch scheduled posts:', fetchError);
      return NextResponse.json(
        { error: 'Database fetch failed' },
        { status: 500 }
      );
    }

    const merchantScheduledPosts = (scheduledPosts ?? []).filter(
      (post) =>
        typeof post.merchant_id === 'string' && post.merchant_id.length > 0
    );

    if (merchantScheduledPosts.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No posts to publish',
      });
    }

    console.log(
      `📦 Cron: Found ${merchantScheduledPosts.length} posts to publish`
    );

    const scheduledMerchantIds = Array.from(
      new Set(merchantScheduledPosts.map((post) => post.merchant_id))
    );
    const { data: featureSettings, error: featureSettingsError } =
      await supabase
        .from('merchant_feature_settings')
        .select('merchant_id, blog_discover_image_validation_enabled')
        .in('merchant_id', scheduledMerchantIds);

    if (featureSettingsError) {
      console.error(
        'Cron Error: Failed to load blog Discover validation flags:',
        featureSettingsError
      );
      return NextResponse.json(
        { error: 'Failed to load blog feature settings' },
        { status: 500 }
      );
    }

    const reservationRecovery = await recoverMerchantBlogReleaseReservations(
      supabase,
      scheduledMerchantIds
    );

    const { eligiblePosts, skipped, warnings } = getEligibleScheduledPosts(
      merchantScheduledPosts as ScheduledPost[],
      featureSettings ?? []
    );

    if (eligiblePosts.length === 0) {
      return NextResponse.json({
        success: true,
        processed: merchantScheduledPosts.length,
        published: [],
        skipped,
        warnings,
      });
    }

    const postIds = eligiblePosts.map((post) => post.id);
    const merchantIds = Array.from(
      new Set(eligiblePosts.map((post) => post.merchant_id))
    );
    const postsByMerchant = groupPostsByMerchant(eligiblePosts);
    const { data: publishedPosts, error: publishedPostsError } = await supabase
      .from('blog_posts')
      .select('merchant_id')
      .eq('status', 'published')
      .in('merchant_id', merchantIds);

    if (publishedPostsError) {
      console.error(
        'Cron Error: Failed to load published blog counts for revalidation:',
        publishedPostsError
      );
      return NextResponse.json(
        { error: 'Failed to load published blog counts' },
        { status: 500 }
      );
    }

    const publishedPostCountsByMerchant = new Map<string, number>();
    for (const post of publishedPosts ?? []) {
      publishedPostCountsByMerchant.set(
        post.merchant_id,
        (publishedPostCountsByMerchant.get(post.merchant_id) ?? 0) + 1
      );
    }

    for (const [merchantId, merchantPosts] of postsByMerchant) {
      const publishedPostCount =
        (publishedPostCountsByMerchant.get(merchantId) ?? 0) +
        merchantPosts.postSlugs.length;
      const totalPages = Math.max(
        1,
        Math.ceil(publishedPostCount / BLOG_LISTING_PAGE_SIZE)
      );
      merchantPosts.listingPages = Array.from(
        { length: totalPages },
        (_, index) => index + 1
      );
    }

    const claimNow = new Date().toISOString();
    const { data: claimedRows, error: updateError } = await supabase
      .from('blog_posts')
      .update({ status: 'published' })
      .in('id', postIds)
      .eq('status', 'scheduled')
      .lte('published_at', claimNow)
      .select('id, status');

    if (updateError) {
      console.error('Cron Error: Batch update failed:', updateError);
      return NextResponse.json(
        { error: 'Batch update failed' },
        { status: 500 }
      );
    }

    const eligiblePostsById = new Map(
      eligiblePosts.map((post) => [post.id, post])
    );
    const claimedPostIds = new Set<string>();

    const seenClaimRowIds = new Set<string>();

    if (Array.isArray(claimedRows)) {
      for (const row of claimedRows as Array<{
        id: string;
        status?: string | null;
      }>) {
        seenClaimRowIds.add(row.id);
        if (row.status === 'published') {
          claimedPostIds.add(row.id);
          continue;
        }

        const originalPost = eligiblePostsById.get(row.id);
        const code =
          row.status === 'scheduled'
            ? 'BLOG_RELEASE_DEFERRED'
            : row.status === 'draft'
              ? 'BLOG_RELEASE_HELD_EXPIRED_NEWS'
              : 'BLOG_RELEASE_NOT_PUBLISHED';
        const reason =
          row.status === 'scheduled'
            ? 'Deferred by database release policy trigger'
            : row.status === 'draft'
              ? 'Held as draft because fast-track news expired before publication'
              : 'Post remained non-published after database release trigger';

        skipped.push({
          id: row.id,
          slug: originalPost?.slug ?? null,
          code,
          details: {
            status: row.status ?? null,
            reason,
          },
        });
      }

      for (const post of eligiblePosts) {
        if (seenClaimRowIds.has(post.id)) {
          continue;
        }
        skipped.push({
          id: post.id,
          slug: post.slug,
          code: 'BLOG_RELEASE_RESCHEDULED_SKIPPED',
          details: {
            reason:
              'Post was rescheduled or no longer due when the claim update ran',
          },
        });
      }
    } else {
      for (const post of eligiblePosts) {
        skipped.push({
          id: post.id,
          slug: post.slug,
          code: 'BLOG_RELEASE_NOT_PUBLISHED',
          details: {
            status: null,
            reason: 'Claim update did not return row status projection',
          },
        });
      }
    }

    const claimedPosts = eligiblePosts.filter((post) =>
      claimedPostIds.has(post.id)
    );
    if (claimedPosts.length === 0) {
      return NextResponse.json({
        success: true,
        processed: scheduledPosts.length,
        published: [],
        skipped,
        warnings,
      });
    }

    const claimedPostsByMerchant = groupPostsByMerchant(claimedPosts);
    for (const [merchantId, claimedMerchantPosts] of claimedPostsByMerchant) {
      const originalMerchantPosts = postsByMerchant.get(merchantId);
      if (originalMerchantPosts) {
        claimedMerchantPosts.listingPages = originalMerchantPosts.listingPages;
      }
    }
    const { blogRevalidationByMerchant, failedMerchants } =
      await revalidateScheduledPostsByMerchant(
        supabase,
        claimedPostsByMerchant
      );
    const campaignResults = await dispatchScheduledPostZohoCampaigns(
      supabase,
      claimedPosts,
      blogRevalidationByMerchant
    );

    if (failedMerchants.length > 0) {
      return NextResponse.json(
        {
          error: 'Failed to revalidate blog caches for some merchants',
          failedMerchants,
          processed: scheduledPosts.length,
          published: Array.from(claimedPostIds),
          zohoCampaigns: campaignResults,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      processed: scheduledPosts.length,
      published: Array.from(claimedPostIds),
      skipped,
      warnings,
      zohoCampaigns: campaignResults,
      ...(reservationRecovery ? { reservationRecovery } : {}),
    });
  } catch (error) {
    console.error('Cron Job Failed:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
