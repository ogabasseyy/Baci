import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock('@/lib/api-client', () => ({
  apiPost: vi.fn(),
}));

import { CreateNotificationPageClient } from './create-notification-page-client';

describe('CreateNotificationPageClient', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'ResizeObserver',
      class ResizeObserver {
        disconnect() {
          return undefined;
        }
        observe() {
          return undefined;
        }
        unobserve() {
          return undefined;
        }
      }
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does not offer specific merchants without server-resolved read access', () => {
    render(<CreateNotificationPageClient canTargetSpecificMerchants={false} />);

    fireEvent.click(screen.getByLabelText(/target/i));

    expect(
      screen.queryByRole('option', { name: /specific merchants/i })
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(
        'Specific merchant targeting requires merchant read permission.'
      )
    ).toBeInTheDocument();
  });
});
