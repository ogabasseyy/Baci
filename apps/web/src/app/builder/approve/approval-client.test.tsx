import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ApprovalClient } from './approval-client';

const id = '10000000-0000-4000-8000-000000000001';
afterEach(() => vi.unstubAllGlobals());
it('refreshes uncertain receipt status without replaying a confirmation', async () => {
  const receipt = {
    kind: 'receipt',
    receipt: {
      storefrontId: id,
      version: `draft:${id}`,
      receiptId: id,
      publishedVersion: `published:${id}`,
      status: 'verifying',
    },
  } as const;
  const fetcher = vi
    .fn()
    .mockResolvedValue({ ok: true, status: 200, json: async () => receipt });
  vi.stubGlobal('fetch', fetcher);
  render(
    <ApprovalClient
      intentId={id}
      initial={{ view: receipt, error: null, signedOut: false }}
    />
  );
  expect(
    await screen.findByRole('heading', {
      name: 'Publication committed; checking delivery',
    })
  ).toBeVisible();
  expect(fetcher).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Refresh status' }));
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
  expect(
    fetcher.mock.calls.every(([, options]) => options.method === undefined)
  ).toBe(true);
});
it('shows a disabled expired exact revision without a publish action', async () => {
  const view = {
    kind: 'approval',
    intentId: id,
    destinationUrl: 'https://fixture.usebaci.com',
    version: `draft:${id}`,
    preview: null,
    canConfirm: false,
    reason: 'expired',
  };
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => view })
  );
  render(<ApprovalClient intentId={id} />);
  expect(await screen.findByText(`Revision: draft:${id}`)).toBeVisible();
  expect(
    screen.queryByRole('button', { name: 'Publish approved homepage' })
  ).not.toBeInTheDocument();
});
