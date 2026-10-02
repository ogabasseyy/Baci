import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock('@/lib/api-client', () => ({ fetchWithCsrf: mocks.save }));

import { DiscoveryFactsPanel } from './discovery-facts-panel';

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        products: [
          {
            id: 'product-1',
            name: 'HP laptop',
            expectedMetadata: null,
            draft: { product_type: 'laptop' },
            evidence: { category: 'Laptops' },
            specifications: [],
            warnings: [],
          },
        ],
        nextCursor: null,
      }),
    })
  );
  mocks.save.mockResolvedValue({ ok: true });
});
it('requires review and sends the snapshot; editing clears approval', async () => {
  render(<DiscoveryFactsPanel />);
  fireEvent.click(screen.getByRole('button', { name: 'Review catalog facts' }));
  await screen.findByText('HP laptop');
  const save = screen.getByRole('button', { name: 'Save verified facts' });
  expect(save).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox'));
  expect(save).toBeEnabled();
  fireEvent.change(screen.getByRole('textbox'), {
    target: { value: '{"product_type":"laptop","model":"HP 14"}' },
  });
  expect(save).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(save);
  await screen.findByText('Verified facts saved.');
  expect(JSON.parse(mocks.save.mock.calls[0][1].body)).toMatchObject({
    expectedMetadata: null,
    metadata: { model: 'HP 14' },
  });
});
it('preserves the editor and reports stale snapshot failures', async () => {
  mocks.save.mockResolvedValue({ ok: false, status: 409 });
  render(<DiscoveryFactsPanel />);
  fireEvent.click(screen.getByRole('button', { name: 'Review catalog facts' }));
  await screen.findByText('HP laptop');
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'Save verified facts' }));
  await waitFor(() =>
    expect(screen.getByRole('status')).toHaveTextContent('Facts changed.')
  );
  expect(screen.getByRole('textbox')).toHaveValue(
    '{\n  "product_type": "laptop"\n}'
  );
});
