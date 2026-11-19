import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OnboardingReminderBanner } from './onboarding-reminder';

const mocks = vi.hoisted(() => ({
  pathname: '/dashboard/products',
  fetch: vi.fn(),
  mutate: vi.fn(),
}));
vi.mock('next/navigation', () => ({ usePathname: () => mocks.pathname }));
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock('@/lib/api-client', () => ({ fetchWithCsrf: mocks.mutate }));
const merchantId = '11111111-1111-4111-8111-111111111111';
const reminder = {
  id: 'first_product',
  title: 'Finish setting up your store',
  action: 'Publish your first product',
  description: 'Add a published product',
  href: '/dashboard/products?onboarding=true',
};
function respond(value: unknown) {
  return { ok: true, json: async () => value };
}
describe('onboarding reminder banner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.pathname = '/dashboard/products';
    vi.stubGlobal('fetch', mocks.fetch);
    mocks.fetch.mockResolvedValue(respond({ merchantId, reminder }));
    mocks.mutate.mockResolvedValue({ ok: true });
  });
  it('renders one actionable reminder and persists snooze with CSRF protection', async () => {
    render(<OnboardingReminderBanner merchantId={merchantId} />);
    expect(
      await screen.findByRole('link', { name: reminder.action })
    ).toHaveAttribute('href', reminder.href);
    fireEvent.click(screen.getByRole('button', { name: 'Remind me tomorrow' }));
    await waitFor(() =>
      expect(
        screen.queryByRole('link', { name: reminder.action })
      ).not.toBeInTheDocument()
    );
    expect(mocks.mutate).toHaveBeenCalledWith(
      expect.stringContaining(merchantId),
      {
        method: 'PATCH',
        body: JSON.stringify({ action: 'snooze' }),
      }
    );
  });
  it('hides completed reminders after navigation and refreshes on focus', async () => {
    const view = render(<OnboardingReminderBanner merchantId={merchantId} />);
    await screen.findByRole('link', { name: reminder.action });
    mocks.fetch.mockResolvedValue(respond({ merchantId, reminder: null }));
    mocks.pathname = '/dashboard/settings';
    view.rerender(<OnboardingReminderBanner merchantId={merchantId} />);
    await waitFor(() =>
      expect(
        screen.queryByRole('link', { name: reminder.action })
      ).not.toBeInTheDocument()
    );
    const count = mocks.fetch.mock.calls.length;
    fireEvent.focus(window);
    await waitFor(() =>
      expect(mocks.fetch.mock.calls.length).toBeGreaterThan(count)
    );
  });
  it('ignores stale responses from a previous merchant', async () => {
    let resolve: (value: unknown) => void = () => {};
    mocks.fetch.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      })
    );
    const view = render(<OnboardingReminderBanner merchantId={merchantId} />);
    const otherId = '22222222-2222-4222-8222-222222222222';
    mocks.fetch.mockResolvedValue(
      respond({ merchantId: otherId, reminder: null })
    );
    view.rerender(<OnboardingReminderBanner merchantId={otherId} />);
    await act(async () => {
      resolve(respond({ merchantId, reminder }));
    });
    expect(
      screen.queryByRole('link', { name: reminder.action })
    ).not.toBeInTheDocument();
  });
  it('keeps the reminder visible when snooze fails and gives retry feedback', async () => {
    mocks.mutate.mockRejectedValueOnce(new Error('offline'));
    render(<OnboardingReminderBanner merchantId={merchantId} />);
    await screen.findByRole('link', { name: reminder.action });
    fireEvent.click(screen.getByRole('button', { name: 'Remind me tomorrow' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not snooze'
    );
    expect(
      screen.getByRole('link', { name: reminder.action })
    ).toBeInTheDocument();
  });
  it('does not let a focus refresh resurrect a reminder while snooze is saving', async () => {
    let resolve: (value: unknown) => void = () => {};
    mocks.mutate.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      })
    );
    render(<OnboardingReminderBanner merchantId={merchantId} />);
    await screen.findByRole('link', { name: reminder.action });
    fireEvent.click(screen.getByRole('button', { name: 'Remind me tomorrow' }));
    const count = mocks.fetch.mock.calls.length;
    fireEvent.focus(window);
    await act(async () => {
      resolve({ ok: true });
    });
    expect(mocks.fetch).toHaveBeenCalledTimes(count);
    expect(
      screen.queryByRole('link', { name: reminder.action })
    ).not.toBeInTheDocument();
  });
  it('keeps the banner stable during refresh and hides it when refresh fails', async () => {
    let resolve: (value: unknown) => void = () => {};
    render(<OnboardingReminderBanner merchantId={merchantId} />);
    await screen.findByRole('link', { name: reminder.action });
    mocks.fetch.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      })
    );
    fireEvent.focus(window);
    expect(
      screen.getByRole('link', { name: reminder.action })
    ).toBeInTheDocument();
    await act(async () => {
      resolve({ ok: false });
    });
    expect(
      screen.queryByRole('link', { name: reminder.action })
    ).not.toBeInTheDocument();
  });
  it('ignores a background refresh that returns after a successful snooze', async () => {
    let resolve: (value: unknown) => void = () => {};
    render(<OnboardingReminderBanner merchantId={merchantId} />);
    await screen.findByRole('link', { name: reminder.action });
    mocks.fetch.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      })
    );
    fireEvent.focus(window);
    fireEvent.click(screen.getByRole('button', { name: 'Remind me tomorrow' }));
    await waitFor(() => expect(mocks.mutate).toHaveBeenCalled());
    await act(async () => {
      resolve(respond({ merchantId, reminder }));
    });
    expect(
      screen.queryByRole('link', { name: reminder.action })
    ).not.toBeInTheDocument();
  });
  it('fails closed on failed requests or mismatched scope', async () => {
    mocks.fetch.mockResolvedValueOnce({ ok: false });
    const view = render(<OnboardingReminderBanner merchantId={merchantId} />);
    await waitFor(() => expect(mocks.fetch).toHaveBeenCalled());
    expect(
      screen.queryByRole('link', { name: reminder.action })
    ).not.toBeInTheDocument();
    mocks.fetch.mockResolvedValueOnce(
      respond({ merchantId: '22222222-2222-4222-8222-222222222222', reminder })
    );
    mocks.pathname = '/dashboard';
    view.rerender(<OnboardingReminderBanner merchantId={merchantId} />);
    await waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(2));
    expect(
      screen.queryByRole('link', { name: reminder.action })
    ).not.toBeInTheDocument();
  });
});
