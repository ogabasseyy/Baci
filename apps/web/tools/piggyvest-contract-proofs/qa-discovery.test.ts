import { afterEach, describe, expect, it } from 'vitest';
import { resolvePiggyvestStagingSyntheticIdentity } from '@/lib/piggyvest/staging-synthetic-identity';
import { type CallResult, qaIdentityFor } from './provider-ops';
import { discoverQaCustomer, selectQaCustomer } from './qa-discovery';
import { makeHarness } from './test-harness.test-support';

const qa = qaIdentityFor('qa-customer-0001');
const email = resolvePiggyvestStagingSyntheticIdentity(qa.qaKey).email;
const mine = {
  id: 'customer-mine-0001',
  third_party_identifier: qa.thirdPartyIdentifier,
};

describe('selectQaCustomer: a customer is selected only on proof it is ours', () => {
  it('accepts exactly one row that echoes our identifier', () => {
    expect(selectQaCustomer([mine], qa)).toMatchObject({
      customerId: 'customer-mine-0001',
      reason: 'found',
    });
  });

  it('accepts a row that does not echo the identifier but carries our synthetic email', () => {
    const row = { id: 'customer-mine-0002', email: email.toUpperCase() };
    expect(selectQaCustomer([row], qa)).toMatchObject({
      customerId: 'customer-mine-0002',
      reason: 'found',
    });
  });

  it('refuses rows that prove nothing (a provider that ignores the filter)', () => {
    const others = [
      { id: 'someone-else-1' },
      { id: 'someone-else-2', email: 'real@example.org' },
    ];
    expect(selectQaCustomer(others, qa)).toMatchObject({
      customerId: null,
      reason: 'unverifiable',
    });
  });

  it('refuses a row that echoes a different identifier, even if it is the only row', () => {
    const row = {
      id: 'someone-else-1',
      third_party_identifier: 'baci:other:customer',
    };
    expect(selectQaCustomer([row], qa)).toMatchObject({
      customerId: null,
      reason: 'unverifiable',
    });
  });

  it('refuses ambiguity', () => {
    expect(
      selectQaCustomer([mine, { ...mine, id: 'customer-mine-0009' }], qa)
    ).toMatchObject({ customerId: null, reason: 'ambiguous' });
  });

  it('reports an empty list as none', () => {
    expect(selectQaCustomer([], qa)).toMatchObject({
      customerId: null,
      reason: 'none',
    });
  });
});

let dispose: (() => void) | null = null;
afterEach(() => dispose?.());

describe('discoverQaCustomer (through the guarded client)', () => {
  it('finds the customer created for this QA key and nobody else', async () => {
    const h = makeHarness();
    dispose = h.dispose;
    await h.api.createCustomer(h.ctx.qa, 'x/create');
    const found = await discoverQaCustomer(h.api, h.ctx.qa);
    expect(found.reason).toBe('found');
    expect(found.customerId).toBe(h.mock.sandbox.customers[0].id);
    expect(
      (await discoverQaCustomer(h.api, qaIdentityFor('qa-customer-0002')))
        .customerId
    ).toBeNull();
  });
});

describe('discoverQaCustomer: a failed lookup is not a discovery', () => {
  const failedCall = (data: unknown): CallResult => ({
    ok: false,
    httpStatus: 503,
    data,
    envelope: null,
    message: null,
    declined: false,
    errorCode: null,
    typedAccepted: null,
  });

  it('does not select a customer from a 503 that kept a matching row', async () => {
    const api = { customersByIdentifier: async () => failedCall([mine]) };
    expect(await discoverQaCustomer(api, qa)).toMatchObject({
      customerId: null,
      reason: 'unverifiable',
    });
  });

  it('does not select a customer from a 200 whose list is not recognised', async () => {
    const api = {
      customersByIdentifier: async () => ({
        ...failedCall({ unexpected: [mine] }),
        ok: true,
        httpStatus: 200,
      }),
    };
    expect(await discoverQaCustomer(api, qa)).toMatchObject({
      customerId: null,
      reason: 'unverifiable',
    });
  });

  it('still reports an empty, recognised list as none', async () => {
    const api = {
      customersByIdentifier: async () => ({
        ...failedCall([]),
        ok: true,
        httpStatus: 200,
      }),
    };
    expect((await discoverQaCustomer(api, qa)).reason).toBe('none');
  });
});
