/** Loopback-only transport fixture. Not a production gateway or deployment artifact. */
import { readFileSync } from 'node:fs';
import { createLocalJWKSet } from 'jose';
import { createBuilderAuthenticator } from '@/lib/builder-connector/authenticate';
import { builderError } from '@/lib/builder-connector/errors';
import { createBuilderGateway } from '@/lib/builder-gateway/gateway';

const issuer = 'https://auth.usebaci.com';
const audience = 'https://mcp.usebaci.com/builder/mcp';
export async function POST(
  request: Request,
  context: { params: Promise<{ tool: string }> }
) {
  const file = process.env.BACI_BUILDER_TASK6_FIXTURE_FILE;
  if (!file)
    return Response.json({ error: 'Fixture disabled' }, { status: 503 });
  const fixture = JSON.parse(readFileSync(file, 'utf8'));
  const gateway = createBuilderGateway({
    authenticate: createBuilderAuthenticator({
      issuer,
      audience,
      key: createLocalJWKSet({ keys: [fixture.publicKey] }),
      readConnection: async (id) =>
        id === fixture.connection.connectionId ? fixture.connection : null,
    }),
    execute: async (_identity, tool) =>
      tool === 'list_storefronts'
        ? { stores: [], nextCursor: null }
        : builderError('INVALID_REQUEST'),
  });
  return gateway(request, (await context.params).tool);
}
