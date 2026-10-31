import { syntheticUuid } from './synthetic-ids';

/** The buyer fields a checkout request carries. */
interface SyntheticBuyer {
  readonly email: string;
  readonly first_name: string;
  readonly last_name: string;
  readonly phone_number: string;
}

interface SyntheticCustomer {
  readonly buyer: SyntheticBuyer;
  readonly id: string;
}

export const SYNTHETIC_CUSTOMER_ONE: SyntheticCustomer = {
  buyer: {
    email: 'ada.synthetic@example.test',
    first_name: 'Ada',
    last_name: 'Synthetic',
    phone_number: '+2348000000001',
  },
  id: syntheticUuid(0xc, 1),
};

export const SYNTHETIC_CUSTOMER_TWO: SyntheticCustomer = {
  buyer: {
    email: 'tunde.synthetic@example.test',
    first_name: 'Tunde',
    last_name: 'Synthetic',
    phone_number: '+2348000000002',
  },
  id: syntheticUuid(0xc, 2),
};

interface SyntheticAgentIdentity {
  /** Value for the `agent-id` header; request-integrity limits its format. */
  readonly agentId: string;
  readonly kind: 'acp' | 'ucp';
  /**
   * The platform profile a UCP agent advertises in its `UCP-Agent` header.
   * Baci does not read that header today, so this is test data only.
   */
  readonly ucpAgentProfileUrl: string | null;
  readonly userAgent: string;
}

export const SYNTHETIC_UCP_AGENT: SyntheticAgentIdentity = {
  agentId: 'synthetic-ucp-platform',
  kind: 'ucp',
  ucpAgentProfileUrl: 'https://platform.example.com/.well-known/ucp',
  userAgent: 'SyntheticUcpPlatform/1.0',
};

export const SYNTHETIC_ACP_CLIENT: SyntheticAgentIdentity = {
  agentId: 'synthetic-acp-client',
  kind: 'acp',
  ucpAgentProfileUrl: null,
  userAgent: 'SyntheticAcpClient/1.0',
};

/** The unsigned identity headers an agentic request carries. */
export function agentIdentityHeaders(
  identity: SyntheticAgentIdentity,
  { apiVersion, requestId }: { apiVersion: string; requestId: string }
): Record<string, string> {
  return {
    'agent-id': identity.agentId,
    'api-version': apiVersion,
    'request-id': requestId,
    'user-agent': identity.userAgent,
  };
}
