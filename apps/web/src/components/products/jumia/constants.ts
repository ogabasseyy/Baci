export const jumiaPreviewMessages = {
  categoryPageSize: 1000,
  upgradeRequired:
    'Marketplace sync requires an upgraded plan. Upgrade your plan to preview Jumia products.',
  unreadableCreation:
    'The server may have created this preview, but the response could not be read. Use “Retry preview creation” only if you accept that it may create another snapshot.',
  creationInFlight:
    'A Gaming preview is already being created for this store. Wait for it to finish before trying again.',
  sharedStorageUnavailable:
    'Browser storage is unavailable, so a new Gaming preview cannot be created safely. Your existing cached preview can still be opened.',
};

export const jumiaPreviewCacheConstants = {
  cachePrefix: 'jumia-gaming-preview:',
  uncertainCreationPrefix: 'jumia-gaming-preview-uncertain:',
  creationLeaseMs: 2 * 60 * 1000,
  creationLeaseRenewalMs: 30 * 1000,
};

export const eligiblePreviewRequestTimeoutMs = 30_000;
