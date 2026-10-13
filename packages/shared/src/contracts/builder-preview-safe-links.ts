import { builderDesignCapabilityAdapter } from './builder-design-capability-adapter';

const socialPlatforms = [
  'facebook',
  'instagram',
  'linkedin',
  'twitter',
  'youtube',
] as const;

const legacyZoneKeyPattern = /^[A-Za-z][A-Za-z0-9_-]{0,79}$/;

function isSafeSocialLinks(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return false;
  const links = value as Record<string, unknown>;
  return (
    Object.keys(links).every((key) =>
      socialPlatforms.includes(key as (typeof socialPlatforms)[number])
    ) &&
    Object.values(links).every(
      (url) =>
        url === undefined ||
        url === '' ||
        builderDesignCapabilityAdapter.isSafeUrl(url)
    )
  );
}

export const previewSafeLinks = {
  isLegacyZoneKey: (value: string) => legacyZoneKeyPattern.test(value),
  isSafeSocialLinks,
};
