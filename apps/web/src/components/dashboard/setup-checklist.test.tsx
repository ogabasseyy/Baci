import {
  isStoreReadiness,
  type MobileStoreReadiness,
  type WebStoreReadiness,
} from '@baci/shared';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { act } from 'react';
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

const readiness = {
  merchantId: '11111111-1111-4111-8111-111111111111',
  surface: 'web',
  isReady: false,
  isPublished: false,
  completedRequired: 0,
  totalRequired: 4,
  completedRecommended: 0,
  totalRecommended: 0,
  overallProgress: 0,
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
      label: 'Add payment method',
      description: 'Connect a payment provider.',
      completed: false,
      priority: 'required',
      category: 'payments',
    },
    {
      id: 'first_product',
      label: 'Add products',
      description: 'Create your first products.',
      completed: false,
      priority: 'required',
      category: 'products',
    },
    {
      id: 'hero_carousel',
      label: 'Customize storefront',
      description: 'Set up your storefront branding.',
      completed: false,
      priority: 'required',
      category: 'store',
    },
    {
      id: 'about_page',
      label: 'Complete business profile',
      description: 'Add required business details.',
      completed: false,
      priority: 'required',
      category: 'legal',
    },
    {
      id: 'analytics',
      label: 'Add marketing pixels',
      description: 'Configure optional tracking.',
      completed: false,
      priority: 'optional',
      category: 'marketing',
    },
  ],
} satisfies WebStoreReadiness;

const mobileReadiness = {
  merchantId: '11111111-1111-4111-8111-111111111111',
  surface: 'mobile',
  isReady: false,
  isPublished: false,
  completedRequired: 0,
  totalRequired: 1,
  completedRecommended: 0,
  totalRecommended: 0,
  overallProgress: 0,
  storeBuild: {
    starterStoreReady: false,
    aiStatus: 'not_started',
    latestJobId: null,
    canApplyAiDraft: false,
    message: 'Store setup is incomplete.',
  },
  items: [
    {
      id: 'first_product',
      label: 'Publish your first product',
      description: 'You need at least one published product to start selling',
      completed: false,
      priority: 'required',
      category: 'products',
    },
  ],
} satisfies MobileStoreReadiness;

describe('SetupChecklist', () => {
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
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => readiness,
    } as Response);
  });

  it('announces the collapsed and expanded state of the setup item toggle', async () => {
    render(<SetupChecklist compact merchantId={readiness.merchantId} />);
    await expandDesktopChecklist();

    const toggle = await screen.findByRole('button', {
      name: 'Show 2 more setup items',
    });

    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    act(() => {
      fireEvent.click(toggle);
    });

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'Show fewer setup items' })
      ).toHaveAttribute('aria-expanded', 'true');
    });
  });

  it('shows a load error instead of rendering malformed readiness data', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ isReady: false }),
    } as Response);

    render(<SetupChecklist compact merchantId={readiness.merchantId} />);
    await expandDesktopChecklist();

    expect(
      await screen.findByText('Failed to load your setup checklist.')
    ).toBeInTheDocument();
  });

  it('shows a load error for an otherwise valid mobile readiness payload', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(isStoreReadiness(mobileReadiness)).toBe(true);
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => mobileReadiness,
    } as Response);

    render(<SetupChecklist compact merchantId={readiness.merchantId} />);
    await expandDesktopChecklist();

    expect(
      await screen.findByText('Failed to load your setup checklist.')
    ).toBeInTheDocument();
  });

  it('resolves checklist item navigation in the web adapter', async () => {
    render(<SetupChecklist compact merchantId={readiness.merchantId} />);
    await expandDesktopChecklist();

    expect(
      await screen.findByRole('link', { name: /add payment method/i })
    ).toHaveAttribute('href', '/dashboard/settings/payments?onboarding=true');
    expect(
      screen.getByRole('link', { name: /customize storefront/i })
    ).toHaveAttribute('href', '/builder?onboarding=true');
  });

  it('publishes the merchant returned by the readiness query', async () => {
    const readyReadiness = {
      ...readiness,
      isReady: true,
      completedRequired: readiness.totalRequired,
      overallProgress: 100,
      items: readiness.items.map((item) => ({ ...item, completed: true })),
    };
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => readyReadiness,
    } as Response);
    vi.mocked(requestMerchantPublish).mockResolvedValue(new Response('{}'));

    render(<SetupChecklist compact merchantId={readiness.merchantId} />);

    await expandDesktopChecklist();
    fireEvent.click(
      await screen.findByRole('button', { name: 'Publish Store' })
    );

    await waitFor(() => {
      expect(requestMerchantPublish).toHaveBeenCalledWith(
        readyReadiness.merchantId,
        false
      );
    });
  });

  it('removes only setup_complete while preserving other URL state', () => {
    window.history.pushState(
      {},
      '',
      '/dashboard?setup_complete=true&tab=orders#recent'
    );

    render(<SetupChecklist compact />);

    expect(window.location.pathname).toBe('/dashboard');
    expect(window.location.search).toBe('?tab=orders');
    expect(window.location.hash).toBe('#recent');
  });
});
