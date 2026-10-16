import { JOINED_TITLE_CORRECTIONS } from '@/config/storefront-content-title-corrections';

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

export function applyJoinedTitleCorrections(value: string) {
  return Object.entries(JOINED_TITLE_CORRECTIONS).reduce(
    (correctedValue, [joinedTitle, correction]) =>
      correctedValue.replace(
        // SAFE (SAST-reviewed): keys come from the repo-controlled
        // JOINED_TITLE_CORRECTIONS config (2 entries) and are
        // escapeRegExp-escaped; user input is only the searched string.
        // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp
        new RegExp(`\\b${escapeRegExp(joinedTitle)}\\b`, 'giu'),
        correction
      ),
    value
  );
}
