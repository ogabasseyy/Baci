export function shouldHideLiveBlogFeaturedStory({
  liveFeaturedSlug,
  preferSnapshot,
  snapshotSlug,
}: {
  liveFeaturedSlug: string | null | undefined;
  preferSnapshot: boolean;
  snapshotSlug: string | null | undefined;
}): boolean {
  return (
    preferSnapshot &&
    typeof liveFeaturedSlug === 'string' &&
    liveFeaturedSlug.length > 0 &&
    liveFeaturedSlug === snapshotSlug
  );
}

export function shouldHideCommittedBlogSnapshot({
  liveFeaturedSlug,
  preferSnapshot,
  snapshotSlug,
}: {
  liveFeaturedSlug: string | null | undefined;
  preferSnapshot: boolean;
  snapshotSlug: string | null | undefined;
}): boolean {
  return preferSnapshot && liveFeaturedSlug !== snapshotSlug;
}
