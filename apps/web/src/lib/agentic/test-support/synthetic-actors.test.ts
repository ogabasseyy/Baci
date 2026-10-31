// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stubAgenticEnv } from './stub-agentic-env';
import {
  agentIdentityHeaders,
  SYNTHETIC_ACP_CLIENT,
  SYNTHETIC_CUSTOMER_ONE,
  SYNTHETIC_CUSTOMER_TWO,
  SYNTHETIC_UCP_AGENT,
} from './synthetic-actors';

describe('synthetic customers', () => {
  it('are two distinct buyers with valid buyer fields', () => {
    expect(SYNTHETIC_CUSTOMER_ONE.id).not.toBe(SYNTHETIC_CUSTOMER_TWO.id);
    expect(SYNTHETIC_CUSTOMER_ONE.buyer.email).not.toBe(
      SYNTHETIC_CUSTOMER_TWO.buyer.email
    );
    for (const { buyer } of [SYNTHETIC_CUSTOMER_ONE, SYNTHETIC_CUSTOMER_TWO]) {
      expect(buyer.email).toMatch(/^[^@\s]+@example\.test$/);
      expect(buyer.phone_number.length).toBeGreaterThanOrEqual(7);
    }
  });
});

describe('synthetic agent identities', () => {
  beforeEach(() => {
    vi.resetModules();
    stubAgenticEnv();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('are a UCP agent with a profile URL and an ACP client without one', () => {
    expect(SYNTHETIC_UCP_AGENT.agentId).not.toBe(SYNTHETIC_ACP_CLIENT.agentId);
    expect(SYNTHETIC_UCP_AGENT.kind).toBe('ucp');
    expect(SYNTHETIC_UCP_AGENT.ucpAgentProfileUrl).toMatch(/^https:\/\//);
    expect(SYNTHETIC_ACP_CLIENT.kind).toBe('acp');
    expect(SYNTHETIC_ACP_CLIENT.ucpAgentProfileUrl).toBeNull();
  });

  it.each([
    SYNTHETIC_UCP_AGENT,
    SYNTHETIC_ACP_CLIENT,
  ])('pass the request integrity agent-id checks for the $kind agent', async (identity) => {
    const { ACP_STABLE_AGENTIC_API_VERSION, verifyAgenticRequestIntegrity } =
      await import('@/lib/agentic/request-integrity');
    const headers = new Headers(
      agentIdentityHeaders(identity, {
        apiVersion: ACP_STABLE_AGENTIC_API_VERSION,
        requestId: 'synthetic_request_1',
      })
    );

    // The agent id and version are accepted; only the signature is missing.
    expect(
      verifyAgenticRequestIntegrity({
        body: '',
        headers,
        secrets: ['synthetic-secret'],
      })
    ).toEqual({ error: 'Missing signature', ok: false });
  });
});
