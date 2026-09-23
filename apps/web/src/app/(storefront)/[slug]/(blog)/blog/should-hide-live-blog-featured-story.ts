export function shouldHideLiveBlogFeaturedStory({
  preferSnapshot,
}: {
  liveFeaturedSlug: string | null | undefined;
  preferSnapshot: boolean;
  snapshotSlug: string | null | undefined;
}): boolean {
  return preferSnapshot;
}

export function shouldHideCommittedBlogSnapshot(_args: {
  liveFeaturedSlug: string | null | undefined;
  preferSnapshot: boolean;
  snapshotSlug: string | null | undefined;
}): boolean {
  return false;
}
