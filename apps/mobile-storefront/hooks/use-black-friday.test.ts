import { fetchBlackFridayProducts } from './use-black-friday';

jest.mock('@/env', () => ({
  EXPO_PUBLIC_API_URL: 'https://staging.ogabassey.com',
}));

const fetchMock = jest.spyOn(global, 'fetch');

afterEach(() => fetchMock.mockReset());
afterAll(() => fetchMock.mockRestore());

it('reads the shared lineup in the order returned by the server', async () => {
  const products = [
    { id: '2', slug: 'second', name: 'Second', price: '₦2', image: '' },
    { id: '1', slug: 'first', name: 'First', price: '₦1', image: '' },
  ];
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ products })));

  await expect(fetchBlackFridayProducts()).resolves.toEqual(products);
  expect(fetchMock).toHaveBeenCalledWith(
    'https://staging.ogabassey.com/api/storefront/black-friday',
    { signal: undefined }
  );
});

it('rejects invalid product data', async () => {
  fetchMock.mockResolvedValueOnce(
    new Response(JSON.stringify({ products: [{ id: '1' }] }))
  );

  await expect(fetchBlackFridayProducts()).rejects.toThrow();
});

it('treats a server failure as an error', async () => {
  fetchMock.mockResolvedValueOnce(new Response(null, { status: 503 }));

  await expect(fetchBlackFridayProducts()).rejects.toThrow();
});
