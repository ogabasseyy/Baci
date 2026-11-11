import { createBuilderUserClientResolver } from '@/lib/builder-connector/account-linking';
import { createBuilderAuthenticator } from '@/lib/builder-connector/authenticate';
import { createBuilderGatewayRuntime } from '@/lib/builder-gateway/runtime';
import {
  BUILDER_ISSUER,
  BUILDER_RESOURCE,
} from '../../../builder-mcp-server/metadata';
import { createProductionExperienceIntegration } from './production-integration';

type GatewaySettings = Parameters<typeof createBuilderGatewayRuntime>[0];
type ExperienceSettings = Parameters<
  typeof createProductionExperienceIntegration
>[0];

/** Trusted co-located composition; tokens resolve through the normal user/RLS client. */
export function createProductionBuilderPorts(settings: {
  signingKey: GatewaySettings['auth']['key'];
  broker: Pick<GatewaySettings['auth'], 'readConnection'> &
    Pick<GatewaySettings['linked'], 'resolveLinkedAccessToken'>;
  supabase: GatewaySettings['linked']['supabase'];
  integration: Omit<
    ExperienceSettings,
    'authenticate' | 'resolveUserClient' | 'legacyGateway'
  >;
}) {
  const auth = {
    key: settings.signingKey,
    readConnection: settings.broker.readConnection,
  };
  const linked = {
    supabase: settings.supabase,
    resolveLinkedAccessToken: settings.broker.resolveLinkedAccessToken,
  };
  const authenticate = createBuilderAuthenticator({
    ...auth,
    issuer: BUILDER_ISSUER,
    audience: BUILDER_RESOURCE,
  });
  return createProductionExperienceIntegration({
    ...settings.integration,
    authenticate,
    resolveUserClient: createBuilderUserClientResolver(linked),
    legacyGateway: createBuilderGatewayRuntime({ auth, linked }),
  });
}
