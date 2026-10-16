import { JOINED_TITLE_CORRECTIONS } from '@/config/storefront-content-title-corrections';

// Literal patterns keep the complete, fixed correction vocabulary auditable.
const corrections = [
  [/\bdonkeykong\b/giu, JOINED_TITLE_CORRECTIONS.donkeykong],
  [/\bairpod\b/giu, JOINED_TITLE_CORRECTIONS.airpod],
] as const;

export function applyJoinedTitleCorrections(value: string) {
  return corrections.reduce(
    (correctedValue, [pattern, correction]) =>
      correctedValue.replace(pattern, correction),
    value
  );
}
