import { STOREFRONT_AGENT_ROUTES } from '../../src/config/storefront-agent-routes';
import type { StorefrontEdgeInventory } from './storefront-edge-inventory-types';

type InventoryRow = StorefrontEdgeInventory['rows'][number];
type MachineFamily = (
  id: string,
  routePattern: string,
  methods: InventoryRow['methods'],
  decision?: InventoryRow['decision']
) => InventoryRow;

/** Well-known machine routes shared by agent and storefront discovery clients. */
export function createStorefrontEdgeMachineWellKnownRows(
  machineFamily: MachineFamily
): readonly InventoryRow[] {
  return [
    machineFamily(
      'machine:well-known-acp',
      STOREFRONT_AGENT_ROUTES.acpProfile,
      ['GET', 'HEAD']
    ),
    machineFamily('machine:well-known-agent-auth', '/.well-known/agent-auth', [
      'GET',
      'HEAD',
      'POST',
    ]),
    machineFamily(
      'machine:well-known-agent-auth-claim',
      '/.well-known/agent-auth/claim',
      ['GET', 'HEAD', 'POST']
    ),
    machineFamily(
      'machine:well-known-agent-auth-revoke',
      '/.well-known/agent-auth/revoke',
      ['GET', 'HEAD', 'POST']
    ),
    machineFamily(
      'machine:well-known-agent-native-commerce',
      STOREFRONT_AGENT_ROUTES.agentNativeCommerce,
      ['GET', 'HEAD']
    ),
    machineFamily(
      'machine:well-known-agent-skill-index',
      STOREFRONT_AGENT_ROUTES.agentSkillIndex,
      ['GET', 'HEAD']
    ),
    machineFamily(
      'machine:well-known-agent-skill-markdown',
      STOREFRONT_AGENT_ROUTES.agentSkillMarkdown,
      ['GET', 'HEAD']
    ),
    machineFamily(
      'machine:well-known-api-catalog',
      STOREFRONT_AGENT_ROUTES.apiCatalog,
      ['GET', 'HEAD']
    ),
    machineFamily(
      'machine:well-known-apple-app-site-association',
      '/.well-known/apple-app-site-association',
      ['GET', 'HEAD']
    ),
    machineFamily(
      'machine:well-known-assetlinks',
      '/.well-known/assetlinks.json',
      ['GET', 'HEAD']
    ),
    machineFamily(
      'machine:well-known-http-signatures',
      '/.well-known/http-message-signatures-directory',
      ['GET', 'HEAD']
    ),
    machineFamily('machine:well-known-llms', '/.well-known/llms.txt', [
      'GET',
      'HEAD',
    ]),
    machineFamily(
      'machine:well-known-llms-full',
      '/.well-known/llms-full.txt',
      ['GET', 'HEAD']
    ),
    machineFamily(
      'machine:well-known-mcp-card',
      STOREFRONT_AGENT_ROUTES.mcpServerCard,
      ['GET', 'HEAD']
    ),
    machineFamily(
      'machine:well-known-oauth-authorization-server',
      '/.well-known/oauth-authorization-server',
      ['GET', 'HEAD']
    ),
    machineFamily(
      'machine:well-known-oauth-agent-auth-v1',
      '/.well-known/oauth-authorization-server/agent-auth/v1',
      ['GET', 'HEAD']
    ),
    machineFamily(
      'machine:well-known-oauth-protected-resource',
      '/.well-known/oauth-protected-resource',
      ['GET', 'HEAD']
    ),
    machineFamily(
      'machine:well-known-openid-configuration',
      '/.well-known/openid-configuration',
      ['GET', 'HEAD']
    ),
    machineFamily(
      'machine:well-known-ucp',
      STOREFRONT_AGENT_ROUTES.ucpProfile,
      ['GET', 'HEAD']
    ),
    machineFamily(
      'machine:well-known-unlisted',
      '/.well-known/{*unlisted?}',
      ['ANY'],
      'edge_terminal'
    ),
  ];
}
