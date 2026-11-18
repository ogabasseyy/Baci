import { getImeiBlacklistState } from '@baci/shared/imei';
import type { ImeiVerdictType } from './get-verdict-colors';
import type { ImeiResultStatusCard } from './imei-check-result-status-cards';
import { isStatusClean } from './is-status-clean';

// Values that mean the report could not tell, not that the check failed.
// Matched anywhere: provider text often adds a reason ("Unknown (retry)").
const NOT_TOLD =
  /\b(unknown|unavailable|not available|not checked|n\/a|pending|unable to check)\b/i;

/**
 * How a finding reads. Only pass/fail findings (blacklist, iCloud, MDM...)
 * get a colour: green when clean, red when not, amber when the report could
 * not tell. Facts such as warranty, dates or country stay neutral, so "Out
 * Of Warranty" is never painted as good news.
 */
export function imeiStatusTone(
  card: Pick<
    ImeiResultStatusCard,
    'blacklist' | 'cleanAware' | 'simLock' | 'value'
  >
): ImeiVerdictType | 'neutral' {
  if (card.blacklist) {
    const state = getImeiBlacklistState(card.value);
    return state === 'clean' ? 'safe' : state === 'risk' ? 'danger' : 'caution';
  }
  if (card.simLock) {
    // A network-locked phone is worth a second look, not a failure.
    const lock = card.value.trim().toLowerCase();
    if (/\bunlocked\b/.test(lock)) return 'safe';
    if (/\blocked\b/.test(lock)) return 'caution';
    return NOT_TOLD.test(lock) ? 'caution' : 'neutral';
  }
  if (!card.cleanAware) return 'neutral';
  if (NOT_TOLD.test(card.value.trim())) return 'caution';
  return isStatusClean(card.value) ? 'safe' : 'danger';
}
