import { WalletPinChangeSchemas } from './wallet-pin-change';

describe('wallet PIN change schemas when the server keeps PiggyVest off', () => {
  it('never accepts a reply without ok:true, so nothing reads as saved', () => {
    expect(
      WalletPinChangeSchemas.response.safeParse({
        primary: false,
        available: false,
      }).success
    ).toBe(false);
  });
});
