import { getImeiBlacklistState } from '@baci/shared/imei';
import { parseProviderLabelMap } from '@/app/api/storefront/imei-check/label-map-parser';
import { parseSickwResponse } from '@/app/api/storefront/imei-check/sickw-parser';
import type { ImeiCheckResult } from '@/app/api/storefront/imei-check/sickw-parser.types';

const PETROCK_LABEL_ALIASES: Readonly<Record<string, string>> = {
  'at&t esn': 'blacklist status',
  'at&t status': 'blacklist status',
  'esim compatible': 'esim compatibility',
  finance: 'finance status',
  'kme status': 'knox enrollment',
  'photo url': 'device photo',
  'simlock status': 'sim lock status',
  'sold to': 'sold by',
  'usa blacklist': 'blacklist status',
  'wi-fi mac address': 'wifi mac',
};

export function parsePetrockReplay(replay: string): Partial<ImeiCheckResult> {
  const labels = parseProviderLabelMap(replay, PETROCK_LABEL_ALIASES);
  // Product 1941's captured Apple model uses an explicit APPLE_A####_ token.
  // Preserve explicit model-number fields and never infer a code from a name.
  if (!labels['model number'] && !labels['model no'] && !labels.mpn) {
    const appleModelCode = /^APPLE_(A\d{4})_/i.exec(labels.model ?? '')?.[1];
    if (appleModelCode) labels['model number'] = appleModelCode.toUpperCase();
  }
  const result = parseSickwResponse(labels);
  // Keep the provider-specific explanation while preserving stronger warnings.
  if (
    getImeiBlacklistState(result.blacklistStatus) === 'unknown' &&
    result.status === 'Unknown' &&
    result.verdict?.startsWith('INCOMPLETE DATA')
  ) {
    return {
      ...result,
      verdict:
        'Blacklist status was not checked. Verify the remaining checks before buying.',
    };
  }
  return result;
}
