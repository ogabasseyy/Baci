import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

const load = vi.hoisted(() => vi.fn());
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({}) }));
vi.mock('@/lib/experience/publication-service', () => ({
  loadLifecycleApproval: load,
}));
vi.mock('@/lib/experience/owner-runtime', () => ({
  getExperienceOwnerRuntime: () => ({
    approval: { preparePublication: vi.fn() },
  }),
}));

import { ApprovalExpired } from '@/lib/experience/approval-service';
import { ExperienceApprovalContent } from './approval-content';

afterEach(cleanup);
it('offers verification-only recovery when a committed receipt is reloaded', async () => {
  load.mockResolvedValue({
    status: 'verifying',
    receiptId: 'receipt',
    action: 'publish',
  });
  render(
    await ExperienceApprovalContent({
      searchParams: Promise.resolve({
        kind: 'lifecycle',
        approval: '11111111-1111-4111-8111-111111111111',
      }),
    })
  );
  expect(
    screen.getByRole('button', { name: 'Retry verification' })
  ).toBeEnabled();
  expect(
    screen.queryByRole('button', { name: 'Confirm publication' })
  ).toBeNull();
});

it('offers a fresh preparation window when normal owner loading reports expiry', async () => {
  load.mockRejectedValueOnce(new ApprovalExpired());
  render(
    await ExperienceApprovalContent({
      searchParams: Promise.resolve({
        kind: 'lifecycle',
        approval: '11111111-1111-4111-8111-111111111111',
      }),
    })
  );
  expect(
    screen.getByRole('button', { name: 'Resume preparation' })
  ).toBeEnabled();
  expect(screen.queryByRole('button', { name: /Confirm/ })).toBeNull();
});
