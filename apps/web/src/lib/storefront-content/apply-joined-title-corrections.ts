import { JOINED_TITLE_CORRECTIONS } from '@/config/storefront-content-title-corrections';

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

export function applyJoinedTitleCorrections(value: string) {
  return Object.entries(JOINED_TITLE_CORRECTIONS).reduce(
    (correctedValue, [joinedTitle, correction]) =>
      correctedValue.replace(
        new RegExp(`\\b${escapeRegExp(joinedTitle)}\\b`, 'giu'),
        correction
      ),
    value
  );
}
