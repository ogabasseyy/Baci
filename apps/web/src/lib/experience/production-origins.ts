import { getDomain } from 'tldts';

/** Trusted startup configuration only; never derive execution origins from a tool,
 * request Host header, merchant source or submitted artifact. */
export function productionOrigin(value: string): string {
  const url = new URL(value);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    url.origin !== value ||
    !getDomain(url.hostname, { allowPrivateDomains: true })
  )
    throw Error('INVALID_PRODUCTION_ORIGIN');
  return url.origin;
}

export function productionDeliveryOrigins(input: {
  executionOrigin: string;
  hostOrigins: readonly string[];
}) {
  const executionOrigin = productionOrigin(input.executionOrigin);
  if (input.hostOrigins.length < 1 || input.hostOrigins.length > 2)
    throw Error('INVALID_HOST_ORIGINS');
  const hostOrigins = [...new Set(input.hostOrigins.map(productionOrigin))];
  const site = getDomain(new URL(executionOrigin).hostname, {
    allowPrivateDomains: true,
  });
  for (const origin of hostOrigins)
    if (
      getDomain(new URL(origin).hostname, { allowPrivateDomains: true }) ===
      site
    )
      throw Error('EXECUTION_SITE_MUST_BE_ISOLATED');
  return { executionOrigin, hostOrigins };
}
