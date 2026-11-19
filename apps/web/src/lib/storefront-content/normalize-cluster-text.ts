import { applyJoinedTitleCorrections } from './apply-joined-title-corrections';
import { normalizeContentCurrencyTokens } from './normalize-content-currency-tokens';

/**
 * Normalizes content cluster text by lowering case, trimming,
 * applying joined title corrections, and normalizing currency tokens.
 */
export const normalizeClusterText = (v: string | null | undefined) =>
  normalizeContentCurrencyTokens(
    applyJoinedTitleCorrections(v?.toLowerCase().trim() ?? '')
  );
