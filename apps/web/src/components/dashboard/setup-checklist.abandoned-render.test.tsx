import type { WebStoreReadiness } from '@baci/shared';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { act, type ReactNode, Suspense, startTransition } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
  SheetDescription: ({ children }: { children: ReactNode }) => <>{children}</>,
  SheetHeader: ({ children }: { children: ReactNode }) => <>{children}</>,
  SheetTitle: ({ children }: { children: ReactNode }) => <>{children}</>,
  SheetTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));
vi.mock('@/lib/merchant-publish-client', () => ({
  requestMerchantPublish: vi.fn(),
}));

function readiness(merchantId: string): WebStoreReadiness {
  return {
    merchantId,
    surface: 'web',
    isReady: true,
    isPublished: false,
    completedRequired: 0,
    totalRequired: 0,
    completedRecommended: 0,
    totalRecommended: 0,
    overallProgress: 0,
    storeBuild: {
      starterStoreReady: true,
      aiStatus: 'not_started',
      latestJobId: null,
      canApplyAiDraft: false,
      message: 'Ready.',
    },
    items: [],
  };
}

describe('SetupChecklist abandoned renders', () => {
  afterEach(() => vi.restoreAllMocks());

  it('accepts merchant A publish after a merchant B render is abandoned', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => readiness('merchant-a'),
    } as Response);
    let resolvePublish!: (response: Response) => void;
    vi.mocked(requestMerchantPublish).mockReturnValue(
      new Promise((resolve) => {
        resolvePublish = resolve;
      })
    );
    const onPublish = vi.fn();
    const never = new Promise<void>(() => undefined);
    function SuspendAbandonedRender({ suspend }: { suspend: boolean }) {
      if (suspend) throw never;
      return null;
    }
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <Suspense fallback={null}>
          <SetupChecklist
            merchantId="merchant-a"
            compact
            onPublish={onPublish}
          />
          <SuspendAbandonedRender suspend={false} />
        </Suspense>
      );
    });
    const summary = await waitFor(() => {
      const button = screen
        .getAllByRole('button')
        .find(
          (candidate) =>
            candidate.getAttribute('aria-controls') ===
            'store-setup-checklist-details'
        );
      expect(button).toBeDefined();
      return button as HTMLElement;
    });
    fireEvent.click(summary);
    fireEvent.click(
      await screen.findByRole('button', { name: 'Publish Store' })
    );
    await waitFor(() => expect(requestMerchantPublish).toHaveBeenCalledOnce());

    act(() => {
      startTransition(() => {
        root.render(
          <Suspense fallback={null}>
            <SetupChecklist
              merchantId="merchant-b"
              compact
              onPublish={onPublish}
            />
            <SuspendAbandonedRender suspend />
          </Suspense>
        );
      });
    });
    await act(async () => resolvePublish(new Response('{}')));

    expect(onPublish).toHaveBeenCalledOnce();
    await act(async () => root.unmount());
    container.remove();
  });
});
