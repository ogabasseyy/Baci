import { describe, expect, it } from 'vitest';
import { piggyvestProvisioningResponseSchemas } from './piggyvest-provisioning-response';

describe('piggyvestProvisioningResponseSchemas', () => {
  it('projects documented customer references without returning provider messages or KYC', () => {
    expect(
      piggyvestProvisioningResponseSchemas.create_customer.parse({
        status: true,
        message: 'untrusted provider text',
        data: {
          customer_id: 'synthetic-customer',
          wallet_id: 'synthetic-wallet',
          new_customer: true,
          bvn: '00000000000',
          email: 'synthetic@example.test',
        },
      })
    ).toEqual({
      status: true,
      data: {
        customer_id: 'synthetic-customer',
        wallet_id: 'synthetic-wallet',
        new_customer: true,
      },
    });
  });

  it('retains the existing customer indicator without interpreting it as ownership proof', () => {
    const parsed = piggyvestProvisioningResponseSchemas.create_customer.parse({
      status: true,
      data: {
        customer_id: 'synthetic-customer',
        wallet_id: 'synthetic-wallet',
        new_customer: false,
      },
    });
    expect(parsed.data.new_customer).toBe(false);
  });

  it('projects only the asynchronous wallet request ID, not a invented readiness flag', () => {
    expect(
      piggyvestProvisioningResponseSchemas.create_plan_wallet.parse({
        status: true,
        data: { id: 'synthetic-wallet', balance: 100, ready: true },
      })
    ).toEqual({ status: true, data: { id: 'synthetic-wallet' } });
  });

  it('preserves an explicit wallet interest setting without inferring it from rates', () => {
    expect(
      piggyvestProvisioningResponseSchemas.create_plan_wallet.parse({
        status: true,
        data: {
          id: 'synthetic-wallet',
          interest_enabled: false,
          creation_interest_rate: 0,
          current_interest_rate: 0,
        },
      })
    ).toEqual({
      status: true,
      data: { id: 'synthetic-wallet', interest_enabled: false },
    });
  });

  it.each([
    { status: false, data: { id: 'synthetic-wallet' } },
    { status: true, data: { id: '' } },
    { status: true, data: { id: null } },
    { status: true, data: { id: 'é'.repeat(257) } },
    { status: true },
  ])('rejects an invalid wallet acknowledgement', (response) => {
    expect(
      piggyvestProvisioningResponseSchemas.create_plan_wallet.safeParse(
        response
      ).success
    ).toBe(false);
  });

  it.each([
    { customer_id: null, wallet_id: 'wallet', new_customer: true },
    { customer_id: 'customer', wallet_id: '', new_customer: true },
    { customer_id: 'customer', wallet_id: 'wallet', new_customer: 'true' },
    { customer_id: 'customer', wallet_id: 'wallet' },
  ])('rejects incomplete customer acknowledgements', (data) => {
    expect(
      piggyvestProvisioningResponseSchemas.create_customer.safeParse({
        status: true,
        data,
      }).success
    ).toBe(false);
  });
});
