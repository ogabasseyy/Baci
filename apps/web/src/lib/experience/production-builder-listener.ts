import 'server-only';
import { createLocalJWKSet, type JSONWebKeySet } from 'jose';
import { getInstalledBuilderGateway } from '@/lib/builder-gateway/runtime';
import { createBuilderMcpNodeServer } from '../../../builder-mcp-server/node';
import { createBuilderTransportVerifier } from '../../../builder-mcp-server/token-verifier';
import { createProductionBuilderLocalForward } from './production-builder-local-forward';

/** Broker public keys and gateway are supplied only by the trusted host process. */
export function createProductionBuilderListener(jwks: JSONWebKeySet) {
  return createBuilderMcpNodeServer({
    experience: { enabled: true },
    verifyAccessToken: createBuilderTransportVerifier(createLocalJWKSet(jwks)),
    executeBuilderTool: createProductionBuilderLocalForward(
      getInstalledBuilderGateway
    ),
  });
}
