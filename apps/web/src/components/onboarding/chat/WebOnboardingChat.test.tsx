import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { submitOnboarding } from '@/app/(platform)/onboarding/actions';
import WebOnboardingChat from './WebOnboardingChat';

const mockGetUser = vi.fn();

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    ...props
  }: {
    children: React.ReactNode;
    href: string;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: vi.fn(() => ({
    auth: {
      getUser: mockGetUser,
      signInWithOAuth: vi.fn(),
      signUp: vi.fn(),
    },
  })),
}));

vi.mock('@/app/(platform)/onboarding/actions', () => ({
  sendMagicLink: vi.fn(),
  submitOnboarding: vi.fn(),
}));

vi.mock('@/components/onboarding-puck-preview', () => ({
  OnboardingPuckPreview: ({ businessName }: { businessName: string }) => (
    <div data-testid="puck-preview">{businessName}</div>
  ),
}));

vi.mock('@/components/logo', () => ({
  Logo: () => <span>Baci</span>,
}));

describe('WebOnboardingChat', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
    mockGetUser.mockResolvedValue({
      data: {
        user: {
          id: 'user-1',
          email: 'ada@example.com',
          user_metadata: { first_name: 'Ada', last_name: 'Okafor' },
        },
      },
    });
    vi.mocked(submitOnboarding).mockResolvedValue({
      success: false,
      code: 'slug_unavailable',
      message: 'That store link is already taken. Please choose another.',
    });
  });

  it('walks through chat store setup, updates live Puck preview, and recovers from slug_unavailable', async () => {
    render(<WebOnboardingChat />);

    await waitFor(() => {
      expect(screen.getByText(/Welcome to Baci, Ada!/)).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: /Nigeria/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Skip for now' }));
    fireEvent.click(screen.getByRole('button', { name: /Fashion/ }));

    fireEvent.change(screen.getByLabelText('Store name input'), {
      target: { value: 'Kicks Hub' },
    });
    fireEvent.click(screen.getByLabelText('Send response'));

    expect(screen.getByTestId('puck-preview').textContent).toBe('Kicks Hub');
    expect(screen.getByText('https://kicks-hub.usebaci.com')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Skip for now' }));
    fireEvent.click(screen.getByRole('button', { name: 'Looks good!' }));
    fireEvent.click(screen.getByRole('button', { name: 'Launch my store' }));

    await waitFor(() => {
      expect(submitOnboarding).toHaveBeenCalledTimes(1);
      expect(screen.getByText(/Type another store link below:/)).toBeTruthy();
    });
  });
});
