import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import OnboardingClient from './onboarding-client';

vi.mock('next/dynamic', () => ({
  default: () =>
    function MockDynamicChat() {
      return <section aria-label="Web onboarding chat">Chat</section>;
    },
}));

describe('OnboardingClient', () => {
  it('renders the dynamically loaded WebOnboardingChat', () => {
    render(<OnboardingClient />);
    expect(
      screen.getByRole('region', { name: 'Web onboarding chat' })
    ).toBeTruthy();
  });
});
