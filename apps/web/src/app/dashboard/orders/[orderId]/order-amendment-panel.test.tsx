import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OrderAmendmentPanel } from './order-amendment-panel';

const mocks = vi.hoisted(() => ({ post: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));
vi.mock('@/lib/api-client', () => ({ fetchWithCsrf: mocks.post }));

const orderId = '1afb87c4-43a3-4be3-97ad-76bc4926b111';
const originalId = '1afb87c4-43a3-4be3-97ad-76bc4926b222';
const replacementId = '1afb87c4-43a3-4be3-97ad-76bc4926b333';
const previewId = '1afb87c4-43a3-4be3-97ad-76bc4926b444';
const documentId = '1afb87c4-43a3-4be3-97ad-76bc4926b555';
const base = {
  canStart: true,
  canEdit: true,
  canRefund: true,
  customer: null,
  summary: null,
  events: [],
  refunds: [],
  bankEvidence: [],
};
const committed = {
  ...base,
  canStart: false,
  summary: { amendmentId: orderId },
  customer: {
    state: 'awaiting_payment',
    holdFulfillment: true,
    balanceDueMinor: 5_000_000,
    refundOwedMinor: 0,
    documentId,
    documentNumber: 1,
  },
};
const quote = {
  previewId,
  expiresAt: '2026-11-21T19:00:00Z',
  beforeLine: { name: 'Original', unitPriceMinor: 30_000_000, quantity: 1 },
  afterLine: { name: 'Replacement', unitPriceMinor: 35_000_000, quantity: 1 },
  beforeTotalMinor: 30_000_000,
  afterTotalMinor: 35_000_000,
  adjustmentMinor: 5_000_000,
};

let fetchMock: ReturnType<typeof vi.fn>;
function show() {
  return render(
    <OrderAmendmentPanel
      orderId={orderId}
      currency="NGN"
      cancelled={false}
      items={[{ id: originalId, name: 'Original', quantity: 1, price: 300000 }]}
      onHoldChange={vi.fn()}
    />
  );
}

async function openPreview() {
  fireEvent.click(await screen.findByRole('button', { name: 'Change items' }));
  fireEvent.change(screen.getByLabelText('Find a replacement'), {
    target: { value: 'iPhone' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Search' }));
  fireEvent.change(await screen.findByLabelText('Replacement'), {
    target: { value: replacementId },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Preview change' }));
  await screen.findByLabelText('Reason');
}

function confirm() {
  fireEvent.change(screen.getByLabelText('Reason'), {
    target: { value: 'Customer requested a change' },
  });
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm change' }));
}

describe('Change items flow', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    fetchMock = vi
      .fn()
      .mockImplementation(async (path: string) =>
        Response.json(
          path.includes('lineId=')
            ? [{ id: replacementId, kind: 'product', label: 'Replacement' }]
            : base
        )
      );
    vi.stubGlobal('fetch', fetchMock);
    mocks.post.mockResolvedValueOnce(Response.json(quote));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('requires consent and creates a fresh preview after a stale response', async () => {
    mocks.post.mockResolvedValueOnce(
      Response.json(
        { code: 'preview_stale', error: 'Preview the replacement again.' },
        { status: 409 }
      )
    );
    mocks.post.mockResolvedValueOnce(
      Response.json({ ...quote, previewId: documentId })
    );
    show();
    await openPreview();
    expect(
      screen.getByRole('button', { name: 'Confirm change' })
    ).toBeDisabled();
    confirm();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Preview the replacement again.'
    );
    expect(screen.queryByRole('button', { name: 'Confirm change' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Preview change' }));
    await waitFor(() => expect(screen.getByRole('checkbox')).not.toBeChecked());
  });

  it('uses an authorized refresh to resolve a lost confirmation response', async () => {
    mocks.post.mockImplementationOnce(async (_path, init) => {
      const { idempotencyKey } = JSON.parse(init.body);
      fetchMock.mockImplementation(async () =>
        Response.json({ ...committed, confirmationKey: idempotencyKey })
      );
      throw new Error('connection dropped after commit');
    });
    show();
    await openPreview();
    confirm();
    const link = await screen.findByRole('link', { name: 'Revised invoice' });
    expect(link).toHaveAttribute(
      'href',
      `/api/orders/${orderId}/invoice?revision=${documentId}`
    );
    expect(mocks.post).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('identifies a competing confirmation without offering to retry it', async () => {
    mocks.post.mockImplementationOnce(async () => {
      fetchMock.mockImplementation(async () => Response.json(committed));
      throw new Error('connection dropped during a competing write');
    });
    show();
    await openPreview();
    confirm();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'A different change was confirmed for this order.'
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('retries an unresolved confirmation with the identical request body', async () => {
    mocks.post.mockRejectedValueOnce(new Error('connection dropped'));
    mocks.post.mockImplementationOnce(async (_path, init) => {
      const { idempotencyKey } = JSON.parse(init.body);
      fetchMock.mockImplementation(async () =>
        Response.json({ ...committed, confirmationKey: idempotencyKey })
      );
      return Response.json(committed.summary);
    });
    show();
    await openPreview();
    confirm();
    fireEvent.click(
      await screen.findByRole('button', { name: 'Retry same confirmation' })
    );
    await screen.findByRole('link', { name: 'Revised invoice' });
    expect(mocks.post.mock.calls[2][1].body).toBe(
      mocks.post.mock.calls[1][1].body
    );
  });

  it('carries the selected SKU label into the confirmation comparison', async () => {
    fetchMock.mockImplementation(async (path: string) =>
      Response.json(
        path.includes('lineId=')
          ? [
              {
                id: replacementId,
                kind: 'variant',
                label: 'Same phone · Black / 256 GB',
              },
            ]
          : base
      )
    );
    mocks.post.mockReset().mockImplementationOnce(async () =>
      Response.json({
        ...quote,
        beforeLine: {
          ...quote.beforeLine,
          name: 'Same phone',
          condition: 'new',
        },
        afterLine: {
          ...quote.afterLine,
          name: 'Same phone',
          condition: 'new',
          variantName: 'Black / 256 GB',
        },
      })
    );
    show();
    await openPreview();
    expect(
      screen.getByText(/Same phone.*256 GB.*× 1/, { selector: 'dd' })
    ).toBeVisible();
  });

  it('lets a refund-authorized operator recheck the capture history', async () => {
    fetchMock.mockImplementation(async () =>
      Response.json({
        ...committed,
        customer: {
          ...committed.customer,
          state: 'awaiting_refund',
          refundOwedMinor: 5_000_000,
        },
        refunds: [
          {
            id: replacementId,
            state: 'needs_attention',
            amountMinor: 5_000_000,
            preflightReview: true,
          },
        ],
      })
    );
    show();
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Refund on hold'
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Recheck refund history' })
    );
    await waitFor(() =>
      expect(mocks.post).toHaveBeenCalledWith(
        `/api/orders/${orderId}/amendments/${orderId}/actions`,
        expect.objectContaining({
          body: expect.stringContaining(`"operationId":"${replacementId}"`),
        })
      )
    );
    expect(JSON.parse(mocks.post.mock.calls[0][1].body).action).toBe(
      'refresh_refund_status'
    );
  });

  it('keeps confirmation disabled for staff without refund permission', async () => {
    fetchMock.mockImplementation(async (path: string) =>
      Response.json(
        path.includes('lineId=')
          ? [{ id: replacementId, kind: 'product', label: 'Replacement' }]
          : { ...base, canRefund: false }
      )
    );
    mocks.post
      .mockReset()
      .mockResolvedValueOnce(
        Response.json({ ...quote, adjustmentMinor: -5_000_000 })
      );
    show();
    await openPreview();
    fireEvent.change(screen.getByLabelText('Reason'), {
      target: { value: 'Customer requested a change' },
    });
    fireEvent.click(screen.getByRole('checkbox'));
    expect(
      screen.getByRole('button', { name: 'Confirm change' })
    ).toBeDisabled();
    expect(mocks.post).toHaveBeenCalledTimes(1);
  });
});
