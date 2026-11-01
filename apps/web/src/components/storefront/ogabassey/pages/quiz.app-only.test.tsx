import { fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCustomerAuth } from '@/contexts/customer-auth-context';
import { apiGet } from '@/lib/api-client';
import { appQuizEvent, appQuizEventsResponse } from './app-quiz-event.test-support';
import { OgabasseyV2Quiz } from './quiz';
import { eventResponse, mockCustomer } from './quiz.test-support';

vi.mock('@/contexts/customer-auth-context', () => ({
  useCustomerAuth: vi.fn(),
}));
vi.mock('@/lib/api-client', () => ({ apiGet: vi.fn(), apiPost: vi.fn() }));
vi.mock('../components/deferred-ad-unit', () => ({ DeferredAdUnit: () => null }));
vi.mock('next/navigation', () => ({ usePathname: () => '/ogabassey/quiz' }));
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

const APP_EVENT = appQuizEvent();

function mockListings(legacyEvents = eventResponse.events) {
  vi.mocked(apiGet).mockImplementation(async (_url, options) => {
    const headers = (options?.headers ?? {}) as Record<string, string>;
    return headers['X-Baci-Quiz-Contract'] === '2'
      ? appQuizEventsResponse([APP_EVENT])
      : { ...eventResponse, events: legacyEvents };
  });
}

beforeEach(() => {
  vi.mocked(apiGet).mockReset();
  mockCustomer({ date_of_birth: '2000-01-01' });
});

describe('OgabasseyV2Quiz app-only prize quizzes', () => {
  it('lists the current app quiz with download links', async () => {
    mockListings();

    render(<OgabasseyV2Quiz merchantSlug="ogabassey" />);

    const list = await screen.findByRole('list', { name: 'Quizzes in the app' });
    expect(within(list).getByText('Redmi Warriors')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Get it on Google Play' })).toBeInTheDocument();
  });

  it('lets a shopper retry when the app quiz listing fails', async () => {
    let failV2 = true;
    vi.mocked(apiGet).mockImplementation(async (_url, options) => {
      const headers = (options?.headers ?? {}) as Record<string, string>;
      if (headers['X-Baci-Quiz-Contract'] !== '2') return eventResponse;
      if (failV2) throw new Error('offline');
      return appQuizEventsResponse([APP_EVENT]);
    });

    render(<OgabasseyV2Quiz merchantSlug="ogabassey" />);

    const alert = await screen.findByText("We couldn't load the current quizzes.");
    expect(alert).toBeInTheDocument();
    failV2 = false;
    fireEvent.click(screen.getAllByRole('button', { name: 'Try again' })[0]);

    const list = await screen.findByRole('list', { name: 'Quizzes in the app' });
    expect(within(list).getByText('Redmi Warriors')).toBeInTheDocument();
  });

  it('keeps the web flow for a legacy quiz the app listing does not cover', async () => {
    mockListings();

    render(<OgabasseyV2Quiz merchantSlug="ogabassey" />);

    expect(
      await screen.findByRole('button', { name: 'Start exam for Daily Quiz' })
    ).toBeInTheDocument();
  });

  it('shows the app call to action to signed-out visitors', () => {
    mockCustomer({ date_of_birth: null });
    vi.mocked(useCustomerAuth).mockReturnValue({
      ...vi.mocked(useCustomerAuth)(),
      customer: null,
      isAuthenticated: false,
    });

    render(<OgabasseyV2Quiz merchantSlug="ogabassey" />);

    expect(
      screen.getByRole('heading', { name: 'Play in the Ogabassey app to win' })
    ).toBeInTheDocument();
    expect(apiGet).not.toHaveBeenCalled();
  });
});
