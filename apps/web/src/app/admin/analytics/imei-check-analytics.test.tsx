import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ImeiCheckAnalyticsPanel } from './imei-check-analytics';

const payload = {
  generatedAt: '2026-10-25T12:00:00Z',
  summary: {
    requests: 3,
    completed: 2,
    uniqueDevices: 1,
    unidentified: 0,
    matchedImages: 2,
  },
  topModels: [
    { brand: 'Apple', model: 'iPhone 17 Pro Max', checks: 2, uniqueDevices: 1 },
  ],
  topVariants: [
    {
      brand: 'Apple',
      model: 'iPhone 17 Pro Max',
      color: 'Silver',
      storage: '512GB',
      checks: 2,
    },
  ],
  topBrands: [{ brand: 'Apple', checks: 2 }],
  services: [],
};
afterEach(() => vi.unstubAllGlobals());
describe('IMEI analytics panel', () => {
  it('shows the most checked model and confirmed colour/storage', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => payload });
    vi.stubGlobal('fetch', fetchMock);
    render(<ImeiCheckAnalyticsPanel period="30d" />);
    await screen.findByRole('table', { name: 'Most checked device models' });
    expect(screen.getAllByText('iPhone 17 Pro Max')).toHaveLength(2);
    expect(screen.getByText('Silver')).toBeTruthy();
    expect(screen.getByText('512GB')).toBeTruthy();
    expect(fetchMock.mock.calls[0][0]).toContain('merchantSlug=ogabassey');
  });
  it('shows an error instead of zero data on failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    render(<ImeiCheckAnalyticsPanel period="7d" />);
    await screen.findByRole('alert');
    expect(screen.queryByText('No completed checks yet.')).toBeNull();
  });
  it('recovers when the user retries a failed request', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ ok: true, json: async () => payload });
    vi.stubGlobal('fetch', fetchMock);
    render(<ImeiCheckAnalyticsPanel period="30d" />);
    fireEvent.click(
      await screen.findByRole('button', { name: 'Retry device analytics' })
    );
    await screen.findByRole('table', { name: 'Most checked device models' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('refetches when the analytics period changes', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => payload });
    vi.stubGlobal('fetch', fetchMock);
    const { rerender } = render(<ImeiCheckAnalyticsPanel period="30d" />);
    await screen.findByRole('table', { name: 'Most checked device models' });
    rerender(<ImeiCheckAnalyticsPanel period="7d" />);
    await waitFor(() =>
      expect(fetchMock.mock.calls.at(-1)?.[0]).toContain('period=7d')
    );
  });
});
