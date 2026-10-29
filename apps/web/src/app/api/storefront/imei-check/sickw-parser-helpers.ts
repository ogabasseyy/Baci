import type { ImeiCheckResult } from './sickw-parser.types';

const VERDICT_MESSAGES = {
  blacklisted:
    'DO NOT BUY - This device is reported stolen/lost and may be blacklisted. You could lose your money and face legal issues.',
  clean:
    'SAFE TO BUY - Device appears clean with no major issues. Always verify physically before payment.',
  icloudLocked:
    "CAUTION - Find My iPhone is ON. You cannot reset this device without the owner's Apple ID. Ensure seller disables it before purchase.",
  icloudStatusIssue:
    'DO NOT BUY - iCloud status indicates this device may be marked lost or locked. Do not proceed without official proof.',
  financeUnknown:
    'CAUTION - The finance status is unclear. Verify it before buying.',
  financeIssue:
    'CAUTION - The report indicates a finance balance or overdue payment. Confirm the account is clear before buying.',
  incomplete:
    'INCOMPLETE DATA - Could not verify all device information. Proceed with caution.',
  mdmLocked:
    'CAUTION - Mobile Device Management appears active. Ask the seller to remove management before payment.',
  knoxGuardLocked:
    'CAUTION - Samsung Knox Guard appears active (often carrier-financed). Ask the seller to clear it before payment.',
  miAccountLocked:
    'CAUTION - Xiaomi account lock appears active. Ask the seller to remove the Mi account before payment.',
  miLost:
    'DO NOT BUY - Xiaomi lost status indicates this device may be reported lost. Do not proceed without official proof.',
  simLocked:
    'CAUTION - Device is carrier-locked. Check if it works with your network before buying.',
} as const;

export function inferDeviceType(device: string): ImeiCheckResult['deviceType'] {
  const deviceLower = device.toLowerCase();
  if (
    deviceLower.includes('iphone') ||
    deviceLower.includes('ipad') ||
    deviceLower.includes('apple') ||
    deviceLower.includes('mac')
  ) {
    return 'apple';
  }

  if (
    deviceLower.includes('samsung') ||
    deviceLower.includes('pixel') ||
    deviceLower.includes('xiaomi') ||
    deviceLower.includes('oppo') ||
    deviceLower.includes('android')
  ) {
    return 'android';
  }

  return 'other';
}

export function hasBlacklistIssue(value: string): boolean {
  return hasRiskToken(value, ['blacklisted', 'reported', 'stolen', 'lost']);
}

export function getProviderField(
  data: Record<string, string>,
  keys: readonly string[]
): string {
  for (const key of keys) {
    if (data[key]) {
      return data[key];
    }
  }

  return '';
}

/**
 * True when any risk token appears as a standalone word that is NOT negated by
 * a preceding "not"/"no" (e.g. "not active" → false, "locked" → true).
 */
export function hasRiskToken(
  value: string,
  tokens: readonly string[]
): boolean {
  const words = value
    .trim()
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  if (words.length === 0) {
    return false;
  }

  return words.some((word, index) => {
    if (!tokens.includes(word)) {
      return false;
    }

    const previousWord = words[index - 1];
    return previousWord !== 'not' && previousWord !== 'no';
  });
}

export function buildVerdict({
  hasFinanceIssue,
  hasFinanceUnknown,
  hasIcloudLockOn,
  hasIcloudStatusIssue,
  hasKnoxGuardIssue,
  hasMdmIssue,
  hasMiLockIssue,
  hasMiLostIssue,
  isBlacklisted,
  isSimLocked,
  status,
}: {
  hasFinanceIssue?: boolean;
  hasFinanceUnknown?: boolean;
  hasIcloudLockOn: boolean;
  hasIcloudStatusIssue: boolean;
  hasKnoxGuardIssue: boolean;
  hasMdmIssue: boolean;
  hasMiLockIssue: boolean;
  hasMiLostIssue: boolean;
  isBlacklisted: boolean;
  isSimLocked: boolean;
  status: ImeiCheckResult['status'];
}): { text: string; type: ImeiCheckResult['verdictType'] } {
  if (isBlacklisted || hasMiLostIssue || hasIcloudStatusIssue) {
    return {
      text: hasMiLostIssue
        ? VERDICT_MESSAGES.miLost
        : hasIcloudStatusIssue
          ? VERDICT_MESSAGES.icloudStatusIssue
          : VERDICT_MESSAGES.blacklisted,
      type: 'danger',
    };
  }

  if (hasIcloudLockOn) {
    return {
      text: VERDICT_MESSAGES.icloudLocked,
      type: 'caution',
    };
  }

  if (hasMdmIssue) {
    return {
      text: VERDICT_MESSAGES.mdmLocked,
      type: 'caution',
    };
  }

  if (hasKnoxGuardIssue) {
    return {
      text: VERDICT_MESSAGES.knoxGuardLocked,
      type: 'caution',
    };
  }

  if (hasMiLockIssue) {
    return {
      text: VERDICT_MESSAGES.miAccountLocked,
      type: 'caution',
    };
  }

  if (hasFinanceIssue) {
    return { text: VERDICT_MESSAGES.financeIssue, type: 'caution' };
  }

  if (hasFinanceUnknown) {
    return { text: VERDICT_MESSAGES.financeUnknown, type: 'caution' };
  }

  if (isSimLocked) {
    return {
      text: VERDICT_MESSAGES.simLocked,
      type: 'caution',
    };
  }

  if (status === 'Clean') {
    return {
      text: VERDICT_MESSAGES.clean,
      type: 'safe',
    };
  }

  return {
    text: VERDICT_MESSAGES.incomplete,
    type: 'caution',
  };
}
