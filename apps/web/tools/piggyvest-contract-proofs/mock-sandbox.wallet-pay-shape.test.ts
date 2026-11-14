import { describe, expect, it, vi } from 'vitest';
import { isRestricted } from '@/lib/piggyvest/wallet-pay-send-once';
import { piggyvestWalletPaySchemas } from '@/schemas/piggyvest-wallet-pay';
import { dataOf, type MockCreated } from './mock-reply.test-support';
import { MockSandbox } from './mock-sandbox';

vi.mock('server-only', () => ({}));

const identity = {
  bvn: '00012345678',
  email: 'synthetic+0123456789ab@example.test',
  name: 'Synthetic Customer',
  phone: '+234000123456',
};

describe('bugfix: the mock wallet reply could not satisfy wallet pay (Fable walk 14)', () => {
  it('answers customer and business wallets in the shape the sandbox sends', () => {
    const sandbox = new MockSandbox();
    const created = dataOf<MockCreated>(sandbox.createCustomer(identity, true));
    const main = piggyvestWalletPaySchemas.wallet.parse(
      dataOf(sandbox.retrieveWallet(created.wallet_id))
    );
    const house = piggyvestWalletPaySchemas.wallet.parse(
      dataOf(sandbox.retrieveWallet(sandbox.house.id))
    );
    // Neither is frozen or under a lien, so wallet pay may use both.
    expect(isRestricted(main)).toBe(false);
    expect(isRestricted(house)).toBe(false);
    // The business wallet names no customer (api_customer_id: null).
    expect(main.api_customer_id).toBe(created.customer_id);
    expect(house.api_customer_id).toBeUndefined();
  });
});
