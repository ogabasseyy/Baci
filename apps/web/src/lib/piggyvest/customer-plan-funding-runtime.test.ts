import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { readPiggyvestPlanFundingRuntime } from './customer-plan-funding-runtime';

const base: NodeJS.ProcessEnv = {
  NODE_ENV: 'test',
  PIGGYVEST_SAVINGS_FUNDING_DISPLAY_ENABLED: 'true',
  PIGGYVEST_SAVINGS_FUNDING_BUSINESS_ID: 'business-1',
};

describe('readPiggyvestPlanFundingRuntime interest routing', () => {
  it('defaults owner routing verification to false', () => {
    const result = readPiggyvestPlanFundingRuntime(base);
    expect(result?.configuration).toMatchObject({
      defaultInterestRoutingVerified: false,
    });
  });

  it('enables the routing config only for the complete exact owner attestation', () => {
    const env = {
      ...base,
      PIGGYVEST_SAVINGS_FUNDING_INTEREST_ROUTING_VERIFIED: 'owner-attested',
      PIGGYVEST_SAVINGS_FUNDING_INTEREST_ROUTING_ATTESTATION_ID: 'record-1',
      PIGGYVEST_SAVINGS_FUNDING_INTEREST_ROUTING_ATTESTED_BY: 'owner',
      PIGGYVEST_SAVINGS_FUNDING_INTEREST_ROUTING_BUSINESS_ID: 'business-1',
      PIGGYVEST_SAVINGS_FUNDING_INTEREST_ROUTING_GLOBAL_SPLIT: '9%/3%',
      PIGGYVEST_SAVINGS_FUNDING_INTEREST_ROUTING_EXPIRES_AT:
        '2099-01-01T00:00:00Z',
    };
    const result = readPiggyvestPlanFundingRuntime(env);
    expect(result?.configuration).toMatchObject({
      defaultInterestRoutingVerified: true,
      defaultInterestRoutingAttestation: {
        attestationId: 'record-1',
        businessId: 'business-1',
        globalSplit: '9%/3%',
      },
    });
  });

  it('fails closed for a wrong split or incomplete attestation', () => {
    const result = readPiggyvestPlanFundingRuntime({
      ...base,
      PIGGYVEST_SAVINGS_FUNDING_INTEREST_ROUTING_VERIFIED: 'owner-attested',
      PIGGYVEST_SAVINGS_FUNDING_INTEREST_ROUTING_GLOBAL_SPLIT: '9%',
    });
    expect(result?.configuration).toMatchObject({
      defaultInterestRoutingVerified: false,
    });
    expect(result?.configuration).not.toHaveProperty(
      'defaultInterestRoutingAttestation'
    );
  });
});
