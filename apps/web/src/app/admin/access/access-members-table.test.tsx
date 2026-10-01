import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AccessMembersTable } from './access-members-table';

const member = {
  created_at: '2026-08-05T10:00:00.000Z',
  email: 'owner@example.test',
  granted_at: '2026-08-05T10:00:00.000Z',
  is_legacy_owner: true,
  is_revocable: false,
  reason: 'legacy_platform_owner',
  revoked_at: null,
  role: 'owner' as const,
  status: 'active' as const,
  updated_at: '2026-08-05T10:00:00.000Z',
};

describe('AccessMembersTable', () => {
  it('marks legacy owners as non-revocable', () => {
    render(<AccessMembersTable members={[member]} onRevoke={vi.fn()} />);

    expect(screen.getByText(/legacy owner/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Revoke' })).toBeDisabled();
  });

  it('renders a safe empty state', () => {
    render(<AccessMembersTable members={[]} onRevoke={vi.fn()} />);

    expect(
      screen.getByText(/No managed platform members yet/i)
    ).toBeInTheDocument();
  });
});
