import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import OnboardingClient from './onboarding-client';

vi.mock('next/dynamic', () => ({
  default: () =>
    function MockDynamicChat() {
      return <div data-testid="web-onboarding-chat">Chat</div>;
    },
}));

describe('OnboardingClient', () => {
  it('renders the dynamically loaded WebOnboardingChat', () => {
    render(<OnboardingClient />);
    expect(screen.getByTestId('web-onboarding-chat')).toBeTruthy();
  });
});
