import { afterEach, expect, it, vi } from 'vitest';
import { mockGiglFetchWithCoverage } from './gigl.coverage-test-support';

afterEach(() => vi.unstubAllGlobals());
it('provides a synthetic coverage result without network activity', async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  const response = await mockGiglFetchWithCoverage(
    'https://provider.example.test/lga/validateAddress'
  );
  expect(await response.json()).toMatchObject({
    data: { HomeDeliveryStatus: true },
  });
  expect(fetchMock).not.toHaveBeenCalled();
});
it('preserves the installed fetch fixture for other requests', async () => {
  const response = new Response('{}');
  const fetchMock = vi.fn().mockResolvedValue(response);
  vi.stubGlobal('fetch', fetchMock);
  const options = { method: 'POST', body: '{}' };
  expect(
    await mockGiglFetchWithCoverage(
      'https://provider.example.test/price/v3',
      options
    )
  ).toBe(response);
  expect(fetchMock).toHaveBeenCalledWith(
    'https://provider.example.test/price/v3',
    options
  );
});
