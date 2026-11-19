import { BUILDER_ACCOUNT_LINKING_ENABLED } from '@/config/builder-linking';
import { BUILDER_PRIVATE_STORAGE_ENABLED } from '@/config/builder-private-storage';
import { getInstalledBuilderGateway } from '@/lib/builder-gateway/runtime';
import { allowsLocalExperienceRequest } from '@/lib/experience/local-profile';
// Build finalization uses the separately bounded five-minute MCP transport.
export const maxDuration = 300;
// Cache Components uses the default Node runtime; no Edge runtime/imports here.
export async function POST(
  request: Request,
  context: { params: Promise<{ tool: string }> }
) {
  const gateway = getInstalledBuilderGateway();
  if (
    ((!BUILDER_ACCOUNT_LINKING_ENABLED || !BUILDER_PRIVATE_STORAGE_ENABLED) &&
      !allowsLocalExperienceRequest(request)) ||
    !gateway
  )
    return Response.json(
      { error: 'Builder gateway is not enabled.' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } }
    );
  return gateway(request, (await context.params).tool);
}
