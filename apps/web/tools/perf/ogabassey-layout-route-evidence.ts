export type NegativeRouteKind = 'category' | 'pdp' | 'blog' | 'generic';

export function assertNegativeRouteEvidence(
  kind: NegativeRouteKind,
  html: string,
  evidence: Record<NegativeRouteKind, string>
): void {
  const expected = evidence[kind];
  if (!expected?.trim() || !html.includes(expected)) {
    throw new Error(`${kind} route evidence is missing`);
  }
}
