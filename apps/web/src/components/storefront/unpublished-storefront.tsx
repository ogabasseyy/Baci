export async function loadUnpublishedStorefront() {
  const { StoreNotPublished } = await import('./store-not-published');

  return StoreNotPublished;
}
