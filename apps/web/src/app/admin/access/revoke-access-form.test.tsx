import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/lib/api-client', () => ({ fetchWithCsrf: vi.fn() }));

import { RevokeAccessForm } from './revoke-access-form';

class ResizeObserverStub {
  disconnect() {}
  observe() {}
  unobserve() {}
}

const globals = globalThis as unknown as {
  ResizeObserver?: typeof ResizeObserverStub;
};
globals.ResizeObserver ??= ResizeObserverStub;

const member = {
  created_at: '2026-08-05T10:00:00.000Z',
  email: 'operator@example.test',
  granted_at: '2026-08-05T10:00:00.000Z',
  is_legacy_owner: false,
  is_revocable: true,
  reason: 'Operational access',
  revoked_at: null,
  role: 'support' as const,
  status: 'active' as const,
  updated_at: '2026-08-05T10:00:00.000Z',
};

describe('RevokeAccessForm', () => {
  it('requires a confirmation before enabling the destructive action', () => {
    render(
      <RevokeAccessForm
        member={member}
        onCancel={vi.fn()}
        onComplete={vi.fn().mockResolvedValue(undefined)}
      />
    );

    expect(
      screen.getByRole('button', { name: 'Confirm revocation' })
    ).toBeDisabled();
  });
});
