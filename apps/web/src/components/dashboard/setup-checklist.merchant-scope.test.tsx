import type { WebStoreReadiness } from '@baci/shared';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { act, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { requestMerchantPublish } from '@/lib/merchant-publish-client';
import { SetupChecklist } from './setup-checklist';

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock('@/components/ui/sheet', () => ({
  Sheet: ({ children }: { children: ReactNode }) => <>{children}</>,
  SheetContent: () => null,
  SheetDescription: ({ children }: { children: ReactNode }) => (
    <p>{children}</p>
  ),
  SheetHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SheetTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  SheetTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock('@/lib/merchant-publish-client', () => ({
  requestMerchantPublish: vi.fn(),
}));

function getReadiness(merchantId: string, isReady = false): WebStoreReadiness {
  return {
    merchantId,
    surface: 'web',
    isReady,
    isPublished: false,
    completedRequired: isReady ? 1 : 0,
    totalRequired: 1,
    completedRecommended: 0,
    totalRecommended: 0,
    overallProgress: isReady ? 100 : 0,
    storeBuild: {
      starterStoreReady: false,
      aiStatus: 'not_started',
      latestJobId: null,
      canApplyAiDraft: false,
      message: 'Store setup is incomplete.',
    },
    items: [
      {
        id: 'payment_method',
        label: `Add payment method for ${merchantId}`,
        description: 'Connect a payment provider.',
        completed: isReady,
        priority: 'required',
        category: 'payments',
      },
    ],
  };
}

describe('SetupChecklist merchant scope', () => {
  async function expandDesktopChecklist() {
    const trigger = await waitFor(() => {
      const button = screen
        .getAllByRole('button')
        .find(
          (candidate) =>
            candidate.getAttribute('aria-controls') ===
            'store-setup-checklist-details'
        );
      if (!button) return null;
      if (button.getAttribute('aria-expanded') === 'true') return null;
      return button as HTMLElement;
    });
    if (trigger) fireEvent.click(trigger);
  }

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('uses the selected merchant for readiness and publishing', async () => {
    const selectedMerchantId = 'merchant-b';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => getReadiness(selectedMerchantId, true),
    } as Response);
    vi.mocked(requestMerchantPublish).mockResolvedValue(new Response('{}'));

    render(<SetupChecklist merchantId={selectedMerchantId} compact />);
    await expandDesktopChecklist();
    await screen.findByRole('button', { name: 'Publish Store' });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      `/api/merchant/readiness?merchantId=${selectedMerchantId}`,
      { cache: 'no-store' }
    );

    fireEvent.click(screen.getByRole('button', { name: 'Publish Store' }));

    await waitFor(() => {
      expect(requestMerchantPublish).toHaveBeenCalledWith(
        selectedMerchantId,
        false
      );
    });
  });

  it('clears merchant A readiness before showing merchant B readiness', async () => {
    let resolveMerchantA: ((value: Response) => void) | undefined;
    const merchantARequest = new Promise<Response>((resolve) => {
      resolveMerchantA = resolve;
    });
    const merchantB = getReadiness('merchant-b');
    vi.spyOn(globalThis, 'fetch')
      .mockReturnValueOnce(merchantARequest)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => merchantB,
      } as Response);

    const { rerender } = render(
      <SetupChecklist merchantId="merchant-a" compact />
    );

    rerender(<SetupChecklist merchantId="merchant-b" compact />);
    await expandDesktopChecklist();

    expect(screen.queryByText('Add payment method for merchant-a')).toBeNull();
    expect(
      await screen.findByText('Add payment method for merchant-b')
    ).toBeVisible();
    expect(globalThis.fetch).toHaveBeenLastCalledWith(
      '/api/merchant/readiness?merchantId=merchant-b',
      { cache: 'no-store' }
    );

    resolveMerchantA?.({
      ok: true,
      json: async () => getReadiness('merchant-a'),
    } as Response);

    await waitFor(() => {
      expect(
        screen.queryByText('Add payment method for merchant-a')
      ).toBeNull();
    });
  });

  it('does not render merchant A readiness during the immediate merchant B rerender', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const merchantBRequest = new Promise<Response>(() => undefined);
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        json: async () => getReadiness('merchant-a'),
      } as Response)
      .mockReturnValueOnce(merchantBRequest);

    const container = document.createElement('div');
    const root = createRoot(container);

    await act(async () => {
      root.render(<SetupChecklist merchantId="merchant-a" compact />);
    });

    expect(container).toHaveTextContent('Add payment method for merchant-a');

    flushSync(() => {
      root.render(<SetupChecklist merchantId="merchant-b" compact />);
    });

    expect(container).not.toHaveTextContent(
      'Add payment method for merchant-a'
    );

    await act(async () => {
      root.unmount();
    });
  });

  it('clears merchant A publishing after it completes while merchant B is active', async () => {
    let resolvePublish: ((value: Response) => void) | undefined;
    const publishRequest = new Promise<Response>((resolve) => {
      resolvePublish = resolve;
    });
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        json: async () => getReadiness('merchant-a', true),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => getReadiness('merchant-b'),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => getReadiness('merchant-a', true),
      } as Response);
    vi.mocked(requestMerchantPublish).mockReturnValue(publishRequest);

    const { rerender } = render(
      <SetupChecklist merchantId="merchant-a" compact />
    );

    await expandDesktopChecklist();
    fireEvent.click(
      await screen.findByRole('button', { name: 'Publish Store' })
    );

    rerender(<SetupChecklist merchantId="merchant-b" compact />);

    await act(async () => {
      resolvePublish?.(new Response('{}'));
    });

    rerender(<SetupChecklist merchantId="merchant-a" compact />);
    await expandDesktopChecklist();
    expect(
      await screen.findByRole('button', { name: 'Publish Store' })
    ).toBeEnabled();
  });

  it('keeps merchant A publishing while merchant B publish settles first', async () => {
    let resolveMerchantAPublish: ((value: Response) => void) | undefined;
    let resolveMerchantBPublish: ((value: Response) => void) | undefined;
    const merchantAPublish = new Promise<Response>((resolve) => {
      resolveMerchantAPublish = resolve;
    });
    const merchantBPublish = new Promise<Response>((resolve) => {
      resolveMerchantBPublish = resolve;
    });
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        json: async () => getReadiness('merchant-a', true),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => getReadiness('merchant-b', true),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => getReadiness('merchant-a', true),
      } as Response);
    vi.mocked(requestMerchantPublish)
      .mockReturnValueOnce(merchantAPublish)
      .mockReturnValueOnce(merchantBPublish);

    const { rerender } = render(
      <SetupChecklist merchantId="merchant-a" compact />
    );

    await expandDesktopChecklist();
    fireEvent.click(
      await screen.findByRole('button', { name: 'Publish Store' })
    );

    rerender(<SetupChecklist merchantId="merchant-b" compact />);

    await expandDesktopChecklist();
    fireEvent.click(
      await screen.findByRole('button', { name: 'Publish Store' })
    );

    await act(async () => {
      resolveMerchantBPublish?.(new Response('{}'));
    });

    rerender(<SetupChecklist merchantId="merchant-a" compact />);

    await expandDesktopChecklist();
    expect(
      await screen.findByRole('button', { name: 'Publish Store' })
    ).toBeDisabled();

    await act(async () => {
      resolveMerchantAPublish?.(new Response('{}'));
    });
  });
});
