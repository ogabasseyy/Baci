import { render, screen, waitFor, within } from '@testing-library/react';
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

  it('does not offer a web start for a quiz the app listing covers', async () => {
    // Store staff can read v2 rows through the legacy listing, so the same
    // quiz arrives twice; it must only appear as an app quiz.
    mockListings([{ ...eventResponse.events[0], id: APP_EVENT.id, title: APP_EVENT.title }]);

    render(<OgabasseyV2Quiz merchantSlug="ogabassey" />);

    await screen.findByRole('list', { name: 'Quizzes in the app' });
    expect(
      screen.queryByRole('button', { name: `Start exam for ${APP_EVENT.title}` })
    ).toBeNull();
  });

  it('bugfix: never flashes a web start card while the app listing is loading', async () => {
    vi.mocked(apiGet).mockImplementation((_url, options) => {
      const headers = (options?.headers ?? {}) as Record<string, string>;
      return headers['X-Baci-Quiz-Contract'] === '2'
        ? new Promise(() => undefined)
        : Promise.resolve({
            ...eventResponse,
            events: [{ ...eventResponse.events[0], id: APP_EVENT.id }],
          });
    });

    render(<OgabasseyV2Quiz merchantSlug="ogabassey" />);

    await waitFor(() =>
      expect(screen.queryByText('Loading quiz events…')).toBeNull()
    );
    expect(screen.queryByRole('button', { name: /Start exam/ })).toBeNull();
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
