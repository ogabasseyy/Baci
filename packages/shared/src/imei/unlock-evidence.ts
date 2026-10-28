export type ImeiBlacklistState = 'clean' | 'risk' | 'unknown';

/** Only explicit blacklist evidence counts; iCloud/aggregate status is unrelated. */
export function getImeiBlacklistState(
  value: string | undefined
): ImeiBlacklistState {
  const status = (
    value?.trim().toLowerCase().replace(/\s+/g, ' ') ?? ''
  ).replace(/\blost\s*(?:\/|and|or)\s*stolen\b/g, 'lost or stolen');
  if (!status) return 'unknown';
  const withoutExplicitUnreported = status.replace(
    /\b(?:not reported(?: as)? (?:lost(?:\s*(?:or|\/)\s*stolen)?|stolen|on (?:the )?(?:gsma )?blacklist)|not on (?:the )?(?:gsma )?blacklist)\b/g,
    ''
  );
  const riskTerms = withoutExplicitUnreported.replace(
    /\bnot blacklisted\b|\bnot reported\b|\b(?:not|no) (?:blocked|stolen|lost(?: or stolen)?)\b|\bunblocked\b|\bno blacklist record found\b|\bnot (?:listed|found|matched) (?:on|in) (?:the )?(?:gsma )?blacklist\b/g,
    ''
  );
  const riskClauses = riskTerms
    .replace(/\blost\s*\/\s*stolen\b/g, 'lost or stolen')
    .split(/[,;|/]|\s+and\s+/);
  if (
    riskClauses.some(
      (clause) =>
        !/unknown|unavailable|pending|error|unable/.test(clause) &&
        /\b(?:blacklist(?:ed)?|blocked|reported|stolen|lost)\b/.test(clause)
    )
  )
    return 'risk';
  if (
    /unknown|unavailable|pending|error|unable|not (?:clean|clear)/.test(status)
  )
    return 'unknown';
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
