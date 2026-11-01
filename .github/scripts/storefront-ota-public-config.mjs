export function preserveTiktokCapability(config, currentCapability) {
  if (
    !['true', 'false'].includes(currentCapability) ||
    typeof config.extra?.tiktokBusiness?.isConfigured !== 'boolean'
  ) {
    throw new Error('A verified existing TikTok capability is required.');
  }
  if (
    (config.plugins ?? []).some((plugin) =>
      Array.isArray(plugin)
        ? plugin[0] === '@baci/tiktok-business/plugin'
        : plugin === '@baci/tiktok-business/plugin'
    )
  ) {
    throw new Error('TikTok build plugin options must not be published.');
  }
  return {
    ...config,
    extra: {
      ...config.extra,
      tiktokBusiness: {
        ...config.extra.tiktokBusiness,
        isConfigured: currentCapability === 'true',
      },
    },
  };
}
