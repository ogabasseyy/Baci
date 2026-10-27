import { getImeiBlacklistState } from '@baci/shared/imei';
import { parseProviderLabelMap } from '@/app/api/storefront/imei-check/label-map-parser';
import { parseSickwResponse } from '@/app/api/storefront/imei-check/sickw-parser';
import type { ImeiCheckResult } from '@/app/api/storefront/imei-check/sickw-parser.types';

const PETROCK_LABEL_ALIASES: Readonly<Record<string, string>> = {
  'at&t esn': 'blacklist status',
  'at&t status': 'blacklist status',
  finance: 'finance status',
  'kme status': 'knox enrollment',
  'photo url': 'device photo',
  'sold to': 'sold by',
  'usa blacklist': 'blacklist status',
  'wi-fi mac address': 'wifi mac',
};

export function parsePetrockReplay(replay: string): Partial<ImeiCheckResult> {
  const result = parseSickwResponse(
    parseProviderLabelMap(replay, PETROCK_LABEL_ALIASES)
  );
  // A clean aggregate is never evidence of a clean blacklist.
  const blacklist = getImeiBlacklistState(result.blacklistStatus);
  if (result.status === 'Clean' && blacklist === 'risk') {
    return {
      ...result,
      status: 'Blacklisted',
      verdictType: 'danger',
      verdict: 'Blacklist risk detected. Do not buy this device.',
    };
  }
  if (result.status === 'Clean' && blacklist === 'unknown') {
    return {
      ...result,
      status: 'Unknown',
      verdictType:
        result.verdictType === 'safe' ? 'caution' : result.verdictType,
      verdict:
        result.verdictType === 'safe'
          ? 'Blacklist status was not checked. Verify the remaining checks before buying.'
          : result.verdict,
    };
  }
  return result;
}
