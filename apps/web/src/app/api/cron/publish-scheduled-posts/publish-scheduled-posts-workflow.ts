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

    if (!scheduledPosts || scheduledPosts.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No posts to publish',
      });
    }

    console.log(`📦 Cron: Found ${scheduledPosts.length} posts to publish`);

    const scheduledMerchantIds = Array.from(
      new Set(scheduledPosts.map((post) => post.merchant_id))
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

    const { eligiblePosts, skipped, warnings } = getEligibleScheduledPosts(
      scheduledPosts as ScheduledPost[],
      featureSettings ?? []
    );

    if (eligiblePosts.length === 0) {
      return NextResponse.json({
        success: true,
        processed: scheduledPosts.length,
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

    const { data: claimedRows, error: updateError } = await supabase
      .from('blog_posts')
      .update({ status: 'published' })
      .in('id', postIds)
      .eq('status', 'scheduled')
      .select('id');

    if (updateError) {
      console.error('Cron Error: Batch update failed:', updateError);
      return NextResponse.json(
        { error: 'Batch update failed' },
        { status: 500 }
      );
    }

    const claimedPostIds = new Set(
      (Array.isArray(claimedRows) ? claimedRows : eligiblePosts).map(
        (post) => post.id
      )
    );
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
    });
  } catch (error) {
    console.error('Cron Job Failed:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
