import { type ManifestMerchant, MERCHANT } from './ucp-conformance-data';

export async function buildProfile(merchant: ManifestMerchant = MERCHANT) {
  const { buildAgentCommerceManifest } = await import(
    '@/lib/agentic/agent-commerce-manifest'
  );
  const { buildUcpDiscoveryProfile } = await import(
    '@/lib/agentic/ucp-discovery-profile'
  );
  return buildUcpDiscoveryProfile(
    buildAgentCommerceManifest(merchant, 'https://ogabassey.com')
  );
}
