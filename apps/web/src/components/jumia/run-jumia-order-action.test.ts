import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runJumiaOrderAction } from './run-jumia-order-action';

const { fetchWithCsrf, resolveJumiaLabelUrl } = vi.hoisted(() => ({
  fetchWithCsrf: vi.fn(),
  resolveJumiaLabelUrl: vi.fn((label?: string) =>
    label?.startsWith('https://') ? label : null
  ),
}));

vi.mock('@/lib/api-client', () => ({ fetchWithCsrf }));
vi.mock('./resolve-jumia-label-url', () => ({ resolveJumiaLabelUrl }));

function callbacks() {
  return {
    setLabelUrls: vi.fn(),
    setBlockedLabelUrl: vi.fn(),
    setActionLoading: vi.fn(),
    refetch: vi.fn(),
    toast: vi.fn(),
  };
}

describe('runJumiaOrderAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('posts ordinary actions and refreshes the order on success', async () => {
    fetchWithCsrf.mockResolvedValueOnce(
      new Response(JSON.stringify({ message: 'Packed' }), { status: 200 })
    );
    const actionCallbacks = callbacks();

    await runJumiaOrderAction(
      'pack',
      'order-1',
      'integration-1',
      ['item-1'],
      actionCallbacks
    );

    expect(fetchWithCsrf).toHaveBeenCalledWith(
      '/api/marketplace/jumia/actions',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          action: 'pack',
          integrationId: 'integration-1',
          orderId: 'order-1',
          itemIds: ['item-1'],
        }),
      })
    );
    expect(actionCallbacks.toast).toHaveBeenCalledWith({
      title: 'Success',
      description: 'Packed',
    });
    expect(actionCallbacks.refetch).toHaveBeenCalledOnce();
    expect(actionCallbacks.setActionLoading).toHaveBeenLastCalledWith(null);
  });

  it('reports per-item failures instead of success on HTTP 200', async () => {
    fetchWithCsrf.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ status: 'failed', successCount: 0, errorCount: 2 }),
        { status: 200 }
      )
    );
    const actionCallbacks = callbacks();

    await runJumiaOrderAction(
      'cancel',
      'order-1',
      'integration-1',
      ['item-1', 'item-2'],
      actionCallbacks
    );

    expect(actionCallbacks.toast).toHaveBeenCalledWith({
      title: 'Action Failed',
      description:
        'Jumia rejected every item; nothing was packed, shipped, or cancelled.',
      variant: 'destructive',
    });
    expect(actionCallbacks.refetch).not.toHaveBeenCalled();
    expect(actionCallbacks.setActionLoading).toHaveBeenLastCalledWith(null);
  });

  it('reports partial outcomes with counts and refreshes', async () => {
    fetchWithCsrf.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ status: 'partial', successCount: 1, errorCount: 2 }),
        { status: 200 }
      )
    );
    const actionCallbacks = callbacks();

    await runJumiaOrderAction(
      'ready_to_ship',
      'order-1',
      'integration-1',
      ['item-1', 'item-2', 'item-3'],
      actionCallbacks
    );

    expect(actionCallbacks.toast).toHaveBeenCalledWith({
      title: 'Partial Success',
      description: '1 succeeded, 2 failed.',
      variant: 'destructive',
    });
    expect(actionCallbacks.refetch).toHaveBeenCalledOnce();
    expect(actionCallbacks.setActionLoading).toHaveBeenLastCalledWith(null);
  });

  it('opens a returned print label and exposes it when the popup is blocked', async () => {
    fetchWithCsrf.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          labels: [{ label: 'https://cdn.example/label.pdf' }],
        }),
        { status: 200 }
      )
    );
    vi.spyOn(window, 'open').mockReturnValueOnce(null);
    const actionCallbacks = callbacks();

    await runJumiaOrderAction(
      'print_label',
      'order-1',
      'integration-1',
      ['item-1'],
      actionCallbacks
    );

    expect(actionCallbacks.setBlockedLabelUrl).toHaveBeenCalledWith(
      'https://cdn.example/label.pdf'
    );
    expect(actionCallbacks.setLabelUrls).toHaveBeenCalledWith([
      'https://cdn.example/label.pdf',
    ]);
    expect(actionCallbacks.toast).toHaveBeenCalledWith({
      title: 'Labels Generated',
      description: '1 label ready',
    });
    expect(resolveJumiaLabelUrl).toHaveBeenCalledWith(
      'https://cdn.example/label.pdf'
    );
  });

  it('reports partial label generation while exposing successful labels', async () => {
    fetchWithCsrf.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          status: 'partial',
          successCount: 1,
          errorCount: 1,
          labels: [{ label: 'https://cdn.example/label.pdf' }],
        }),
        { status: 200 }
      )
    );
    const actionCallbacks = callbacks();

    await runJumiaOrderAction(
      'print_label',
      'order-1',
      'integration-1',
      ['item-1', 'item-2'],
      actionCallbacks
    );

    expect(actionCallbacks.setLabelUrls).toHaveBeenCalledWith([
      'https://cdn.example/label.pdf',
    ]);
    expect(actionCallbacks.toast).toHaveBeenCalledWith({
      title: 'Partial Success',
      description: '1 label ready, 1 failed.',
      variant: 'destructive',
    });
    expect(actionCallbacks.refetch).toHaveBeenCalledOnce();
  });

  it('reports failed label generation instead of an empty neutral message', async () => {
    fetchWithCsrf.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ status: 'failed', successCount: 0, errorCount: 2 }),
        { status: 200 }
      )
    );
    const actionCallbacks = callbacks();

    await runJumiaOrderAction(
      'print_label',
      'order-1',
      'integration-1',
      ['item-1', 'item-2'],
      actionCallbacks
    );

    expect(actionCallbacks.setLabelUrls).not.toHaveBeenCalledWith([
      expect.anything(),
    ]);
    expect(actionCallbacks.toast).toHaveBeenCalledWith({
      title: 'Action Failed',
      description: 'Jumia rejected all 2 requested label(s).',
      variant: 'destructive',
    });
    expect(actionCallbacks.refetch).toHaveBeenCalledOnce();
  });

  it('sanitizes non-JSON action failures into a destructive toast', async () => {
    fetchWithCsrf.mockResolvedValueOnce(
      new Response('<h1>provider failed</h1>', { status: 502 })
    );
    const actionCallbacks = callbacks();

    await runJumiaOrderAction(
      'cancel',
      'order-1',
      'integration-1',
      ['item-1'],
      actionCallbacks
    );

    expect(actionCallbacks.toast).toHaveBeenCalledWith({
      title: 'Action Failed',
      description: 'provider failed',
      variant: 'destructive',
    });
    expect(actionCallbacks.setActionLoading).toHaveBeenLastCalledWith(null);
  });
});
