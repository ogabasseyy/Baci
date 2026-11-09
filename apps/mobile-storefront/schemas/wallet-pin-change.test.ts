import { WalletPinChangeSchemas as schemas } from './wallet-pin-change';

describe('wallet PIN change schemas', () => {
  it('accepts 4 to 6 digit PINs', () => {
    expect(
      schemas.request.safeParse({ currentPin: '1234', newPin: '987654' })
        .success
    ).toBe(true);
  });

  it.each([
    ['3 digits', { currentPin: '123', newPin: '9876' }],
    ['7 digits', { currentPin: '1234', newPin: '9876543' }],
    ['letters', { currentPin: '12a4', newPin: '9876' }],
    ['extra keys', { currentPin: '1234', newPin: '9876', userId: 'x' }],
    ['missing key', { currentPin: '1234' }],
  ])('rejects %s', (_label, body) => {
    expect(schemas.request.safeParse(body).success).toBe(false);
  });

  it('requires ok:true in the response', () => {
    expect(schemas.response.safeParse({ ok: true }).success).toBe(true);
    expect(schemas.response.safeParse({ ok: false }).success).toBe(false);
    expect(schemas.response.safeParse({}).success).toBe(false);
  });
});
