import 'server-only';
import { createBuilderUserClientResolver } from '@/lib/builder-connector/account-linking';
import { createBuilderAuthenticator } from '@/lib/builder-connector/authenticate';
import { createBuilderGatewayRuntime } from '@/lib/builder-gateway/runtime';
import {
  BUILDER_ISSUER,
  BUILDER_RESOURCE,
} from '../../../builder-mcp-server/metadata';
import { createVerifierBuildClient } from '../../../tools/experience-verifier/build-client';
import { composeExperienceRuntime } from './compose-runtime';
import { createProductionExperienceIntegration } from './production-integration';

type GatewaySettings = Parameters<typeof createBuilderGatewayRuntime>[0];
type ExperienceSettings = Parameters<
  typeof createProductionExperienceIntegration
>[0];
const usedPorts = new WeakSet<
  ReturnType<typeof createProductionBuilderPorts>
>();

/** Trusted co-located composition; tokens resolve through the normal user/RLS client. */
export function createProductionBuilderPorts(settings: {
  signingKey: GatewaySettings['auth']['key'];
  broker: Pick<GatewaySettings['auth'], 'readConnection'> &
    Pick<GatewaySettings['linked'], 'resolveLinkedAccessToken'>;
  supabase: GatewaySettings['linked']['supabase'];
  buildVerifier?: { key: Uint8Array; port: number };
  integration: Omit<
    ExperienceSettings,
    'authenticate' | 'resolveUserClient' | 'legacyGateway' | 'build'
  > & {
    build: Omit<ExperienceSettings['build'], 'recordVerifiedEvidence'> &
      Partial<Pick<ExperienceSettings['build'], 'recordVerifiedEvidence'>>;
  };
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
  const recordVerifiedEvidence = settings.buildVerifier
    ? createVerifierBuildClient({
        ...settings.buildVerifier,
        resolveLinkedAccessToken: settings.broker.resolveLinkedAccessToken,
      })
    : settings.integration.build.recordVerifiedEvidence;
  if (!recordVerifiedEvidence) throw Error('VERIFIER_NOT_CONFIGURED');
  return createProductionExperienceIntegration({
    ...settings.integration,
    build: { ...settings.integration.build, recordVerifiedEvidence },
    authenticate,
    resolveUserClient: createBuilderUserClientResolver(linked),
    legacyGateway: createBuilderGatewayRuntime({ auth, linked }),
  });
}

/** Trusted process startup; caller owns HTTPS ingress and shared persistence. */
export function installProductionBuilderPorts(
  ports: ReturnType<typeof createProductionBuilderPorts>
) {
  if (usedPorts.has(ports)) throw Error('PORTS_ALREADY_INSTALLED');
  usedPorts.add(ports);
  let uninstall: () => void;
  try {
    uninstall = composeExperienceRuntime(ports.composition);
  } catch (error) {
    ports.dispose();
    throw error;
  }
  let closed = false;
  return {
    deliver: ports.deliver,
    ownerPreviewLaunch: ports.composition.owner.createPreviewLaunch,
    close() {
      if (closed) return;
      closed = true;
      try {
        ports.dispose();
      } finally {
        uninstall();
      }
    },
  };
}
