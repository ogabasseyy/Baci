import { describe, expect, it } from 'vitest';
import {
  piggyvestWalletPaySchemas as schemas,
  WALLET_PAY_MAX_AMOUNT_KOBO,
} from './piggyvest-wallet-pay';

const OP = '5b0f2a40-1c1d-4e6b-9a51-2f3c4d5e6f70';

describe('piggyvestWalletPaySchemas', () => {
  it('bounds amounts to positive integer kobo within the ledger range', () => {
    expect(schemas.amountKobo.safeParse(1).success).toBe(true);
    expect(
      schemas.amountKobo.safeParse(WALLET_PAY_MAX_AMOUNT_KOBO).success
    ).toBe(true);
    expect(
      schemas.amountKobo.safeParse(WALLET_PAY_MAX_AMOUNT_KOBO + 1).success
    ).toBe(false);
    expect(schemas.amountKobo.safeParse(0).success).toBe(false);
    expect(schemas.amountKobo.safeParse(1.5).success).toBe(false);
  });

  it('accepts only purchase references the database accepts', () => {
    expect(schemas.purchaseRef.safeParse(OP).success).toBe(true);
    expect(schemas.purchaseRef.safeParse('vtu_1-a').success).toBe(true);
    expect(schemas.purchaseRef.safeParse('-leading').success).toBe(false);
    expect(schemas.purchaseRef.safeParse('a'.repeat(129)).success).toBe(false);
    expect(schemas.purchaseRef.safeParse('has space').success).toBe(false);
  });

  it('accepts only our own payment and refund references, retries included', () => {
    expect(schemas.reference.safeParse(`pvb-pay-${OP}`).success).toBe(true);
    expect(schemas.reference.safeParse(`pvb-refund-${OP}`).success).toBe(true);
    expect(schemas.reference.safeParse(`pvb-refund-${OP}-20`).success).toBe(
      true
    );
    expect(schemas.reference.safeParse(`pvb-save-${OP}`).success).toBe(false);
    expect(schemas.reference.safeParse(`pvb-refund-${OP}-0`).success).toBe(
      false
    );
    expect(schemas.reference.safeParse('PVB01ABC').success).toBe(false);
  });

  it('takes only the server-priced issue request, nothing more', () => {
    expect(
      schemas.issueRequest.safeParse({
        purpose: 'vtu',
        purchaseRef: 'v1',
        amountKobo: 100,
      }).success
    ).toBe(true);
    expect(
      schemas.issueRequest.safeParse({
        purpose: 'checkout',
        purchaseRef: 'v1',
        amountKobo: 100,
      }).success
    ).toBe(false);
    expect(
      schemas.issueRequest.safeParse({
        purpose: 'vtu',
        purchaseRef: 'v1',
        amountKobo: 100,
        sourceWalletId: 'x',
      }).success
    ).toBe(false);
  });

  it('requires exactly one strict result row', () => {
    expect(schemas.manageRows.safeParse([{ result: true }]).success).toBe(true);
    expect(schemas.manageRows.safeParse([]).success).toBe(false);
    expect(
      schemas.manageRows.safeParse([{ result: true }, { result: false }])
        .success
    ).toBe(false);
    expect(
      schemas.manageRows.safeParse([{ result: true, extra: 1 }]).success
    ).toBe(false);
  });

  it('requires a claim token on a won delivery claim', () => {
    const won = {
      status: 'claimed',
      purpose: 'vtu',
      purchaseRef: 'v1',
      amountKobo: 1,
    };
    expect(schemas.claimRows.safeParse([{ result: won }]).success).toBe(false);
    expect(
      schemas.claimRows.safeParse([{ result: { ...won, claimToken: OP } }])
        .success
    ).toBe(true);
  });

  it('reads business wallets with a null customer and keeps the restriction flags', () => {
    const wallet = schemas.wallet.parse({
      id: 'w',
      api_customer_id: null,
      business_id: 'b',
      currency: 'NGN',
      status: 'active',
      balance: 0,
      is_frozen: false,
      has_an_active_lien: false,
    });
    expect(wallet.api_customer_id).toBeUndefined();
    expect(wallet.is_frozen).toBe(false);
    expect(
      schemas.wallet.safeParse({ ...wallet, status: 'frozen' }).success
    ).toBe(false);
  });
});
