/** Project encrypted provider evidence to hostnames, never usable signed URLs. */
export function observedOxygenHostnames(
  evidence: readonly unknown[]
): string[] {
  const hosts = new Set<string>();
  const object = (value: unknown): Record<string, unknown> | null =>
    value !== null && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  for (const entry of evidence) {
    const item = object(entry);
    if (
      !item ||
      ![
        'selfie',
        'approve',
        'details',
        'upfront_link',
        'repayment_link',
      ].includes(String(item.operation))
    )
      continue;
    for (const value of Object.values(object(item.links) ?? {})) {
      if (typeof value !== 'string') continue;
      try {
        const url = new URL(value);
        // projectOxygenResponse stores only url.origin, never a usable signed
        // provider URL. Reject anything else rather than exposing its token.
        if (
          url.protocol === 'https:' &&
          !url.username &&
          !url.password &&
          !url.port &&
          url.origin === value
        )
          hosts.add(url.hostname);
      } catch {
        /* Ignore malformed encrypted evidence. */
      }
    }
    for (const value of Object.values(object(item.rejectedLinks) ?? {})) {
      const rejected = object(value);
      if (rejected?.reason !== 'host' || typeof rejected.host !== 'string')
        continue;
      try {
        const url = new URL(`https://${rejected.host}`);
        if (
          url.hostname === rejected.host &&
          url.host === rejected.host &&
          url.pathname === '/' &&
          !url.search &&
          !url.hash &&
          !url.username &&
          !url.password
        )
          hosts.add(url.hostname);
      } catch {
        /* Ignore malformed encrypted evidence. */
      }
    }
  }
  return [...hosts].sort().slice(0, 10);
}
