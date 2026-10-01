/** Converts one Next.js App Router segment to the edge inventory syntax. */
export function normalizeStorefrontEdgeRouteSegment(segment: string) {
  const optionalCatchAll = segment.match(/^\[\[\.\.\.([^\]]+)]]$/);
  if (optionalCatchAll) return `{*${optionalCatchAll[1]}?}`;
  const catchAll = segment.match(/^\[\.\.\.([^\]]+)]$/);
  if (catchAll) return `{*${catchAll[1]}}`;
  const parameter = segment.match(/^\[([^\]]+)]$/);
  return parameter ? `{${parameter[1]}}` : segment;
}
