import { WalletPinSchemas } from './wallet-pin';

// With the server keeping PiggyVest off, the status route answers "not
// primary, not available": the schema reads it and nothing offers a PIN flow.
describe('server keeps PiggyVest off', () => {
  it('reads the off answer as not primary and not available', () => {
    const answer = WalletPinSchemas.status.parse({
      primary: false,
      hasPin: false,
      resetRequired: false,
      available: false,
    });
    expect(answer.primary).toBe(false);
    expect(answer.available).toBe(false);
  });

  it('rejects a missing answer instead of guessing one', () => {
    expect(WalletPinSchemas.status.safeParse({}).success).toBe(false);
    expect(WalletPinSchemas.status.safeParse(undefined).success).toBe(false);
  });
});
