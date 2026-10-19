import { getCartShopperToken } from './shopper-token';

it('refuses an Auth token belonging to a different shopper before sending an account mutation', async () => {
  const read = jest.fn().mockResolvedValue({
    access_token: 'private-test-token',
    user: { id: 'user-b' },
  });
  expect(await getCartShopperToken('user-a', read)).toBeNull();
  expect(await getCartShopperToken('user-b', read)).toBe('private-test-token');
  expect(await getCartShopperToken(undefined, read)).toBeNull();
});
