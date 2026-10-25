export type ImeiBlacklistState = 'clean' | 'risk' | 'unknown';

/** Only explicit blacklist evidence counts; iCloud/aggregate status is unrelated. */
export function getImeiBlacklistState(
  value: string | undefined
): ImeiBlacklistState {
  const status = value?.trim().toLowerCase().replace(/\s+/g, ' ') ?? '';
  if (
    !status ||
    /unknown|unavailable|pending|error|unable|not (?:clean|clear)/.test(status)
  )
    return 'unknown';
  const withoutExplicitUnreported = status.replace(
    /\bnot reported(?: as)? (?:lost(?:\s*(?:or|\/)\s*stolen)?|stolen|on (?:the )?(?:gsma )?blacklist)\b/g,
    ''
  );
  const riskTerms = withoutExplicitUnreported.replace(
    /\bnot blacklisted\b|\bnot reported\b/g,
    ''
  );
  if (/blacklist|blocked|reported|stolen|lost/.test(riskTerms)) return 'risk';
  const hasPositiveVerdict =
    withoutExplicitUnreported !== status ||
    /\bnot blacklisted\b|\bclean\b|\bclear\b/.test(status);
  const unrecognized = withoutExplicitUnreported
    .replace(/\bnot blacklisted\b|\bclean\b|\bclear\b/g, '')
    .replace(/[\s,;:/|&().[\]-]|✅/g, '');
  return hasPositiveVerdict && !unrecognized ? 'clean' : 'unknown';
}

/** Shared prerequisite for presentation and server-side assessment. Carrier/model/finance still require verification. */
export function canAssessImeiNetworkUnlock(result: {
  blacklistStatus?: string;
  simLock?: string;
}): boolean {
  const lock =
    result.simLock
      ?.trim()
      .toLowerCase()
      .replace(/[-_\s]+/g, ' ') ?? '';
  return (
    getImeiBlacklistState(result.blacklistStatus) === 'clean' &&
    ['locked', 'sim locked', 'network locked', 'carrier locked'].includes(lock)
  );
}
