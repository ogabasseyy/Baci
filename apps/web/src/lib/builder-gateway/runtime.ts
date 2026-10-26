import type { createBuilderUserClientResolver } from '@/lib/builder-connector/account-linking';
import {
  type BuilderAuthenticatorDependencies,
  createBuilderAuthenticator,
} from '@/lib/builder-connector/authenticate';
import {
  BUILDER_ISSUER,
  BUILDER_RESOURCE,
} from '../../../builder-mcp-server/metadata';
import {
  type BuilderGatewayDependencies,
  type BuilderGatewayHandler,
  createBuilderGateway,
} from './gateway';
import { createBuilderServiceDispatcher } from './services';
/** Explicit private backend composition; never imported into the standalone MCP bundle. */
export function createBuilderGatewayRuntime(settings: {
  auth: Pick<BuilderAuthenticatorDependencies, 'key' | 'readConnection'>;
  linked: Parameters<typeof createBuilderUserClientResolver>[0];
  audit?: BuilderGatewayDependencies['audit'];
}) {
  return createBuilderGateway({
    authenticate: createBuilderAuthenticator({
      ...settings.auth,
      issuer: BUILDER_ISSUER,
      audience: BUILDER_RESOURCE,
    }),
    execute: createBuilderServiceDispatcher(settings.linked),
    audit: settings.audit,
  });
}
let installed: BuilderGatewayHandler | undefined;
/** Future release bootstrap owns installation and credentials. HTTP cannot configure this runtime. */
export function installBuilderGateway(handler: BuilderGatewayHandler) {
  if (installed) throw new Error('Builder gateway already configured');
  installed = handler;
  return () => {
    if (installed === handler) installed = undefined;
  };
}
export function getInstalledBuilderGateway() {
  return installed;
}
