import { describe, expect, it } from 'vitest';
import { decideUcpCartTransfer } from './decide-ucp-cart-transfer';

describe('decideUcpCartTransfer', () => {
  it('is ready for a shared-cart merchant with signed agent access', () => {
    expect(
      decideUcpCartTransfer({
        merchant: { shared_cart_enabled: true },
        signedAgentReadsEnabled: true,
      })
    ).toEqual({ ready: true, reasons: [] });
  });

  it('withholds cart from a merchant not enrolled in shared cart', () => {
    expect(
      decideUcpCartTransfer({
        merchant: { shared_cart_enabled: false },
        signedAgentReadsEnabled: true,
      })
    ).toEqual({ ready: false, reasons: ['shared_cart_not_enrolled'] });
  });

  it('treats a missing enrollment signal as not enrolled', () => {
    expect(
      decideUcpCartTransfer({ merchant: {}, signedAgentReadsEnabled: true })
    ).toEqual({ ready: false, reasons: ['shared_cart_not_enrolled'] });
  });

  it('lists missing agent access and enrollment independently', () => {
    expect(
      decideUcpCartTransfer({ merchant: {}, signedAgentReadsEnabled: false })
    ).toEqual({
      ready: false,
      reasons: ['signed_agent_access_unavailable', 'shared_cart_not_enrolled'],
    });
  });

  it('reads the snapshot hint and the raw premium_features grant the same way', () => {
    const fromHint = decideUcpCartTransfer({
      merchant: { shared_cart_enabled: true },
      signedAgentReadsEnabled: true,
    });
    const fromGrant = decideUcpCartTransfer({
      merchant: { premium_features: ['shared_cart'] },
      signedAgentReadsEnabled: true,
    });
    const revoked = decideUcpCartTransfer({
      merchant: { premium_features: [], shared_cart_enabled: true },
      signedAgentReadsEnabled: true,
    });

    expect(fromHint).toEqual(fromGrant);
    // A raw grant list stays authoritative over a stale hint, as the cart
    // routes' live gate reads the raw grant.
    expect(revoked.ready).toBe(false);
  });
});
