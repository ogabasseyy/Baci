import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

const load = vi.hoisted(() => vi.fn());
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({}) }));
vi.mock('@/lib/experience/publication-service', () => ({
  loadLifecycleApproval: load,
}));
vi.mock('@/lib/experience/owner-runtime', () => ({
  getExperienceOwnerRuntime: () => ({ approval: {} }),
}));

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
