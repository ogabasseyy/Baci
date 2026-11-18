import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

const f = vi.hoisted(() => ({
  load: vi.fn(),
  client: vi.fn(async () => ({})),
}));
vi.mock('@/lib/supabase/server', () => ({ createClient: f.client }));
vi.mock('@/lib/experience/approval-service', () => ({
  loadDraftApproval: f.load,
}));
vi.mock('@/lib/experience/publication-service', () => ({
  loadLifecycleApproval: f.load,
}));
vi.mock('./approval-client', () => ({
  ExperienceApprovalClient: ({ view }: { view: unknown }) => (
    <pre data-testid="approval">{JSON.stringify(view)}</pre>
  ),
}));

import { ExperienceApprovalContent as Page } from './approval-content';

const id = '11111111-1111-4111-8111-111111111111';
it('malformed approval never establishes auth or controls', async () => {
  render(await Page({ searchParams: Promise.resolve({ approval: 'bad' }) }));
  expect(
    screen.getByRole('heading', { name: 'Approval unavailable' })
  ).toBeVisible();
  expect(f.client).not.toHaveBeenCalled();
  expect(f.load).not.toHaveBeenCalled();
});
it('committed receipts render as receipts, never a new confirmation', async () => {
  f.load.mockResolvedValue({ status: 'verifying', receiptId: id });
  render(
    await Page({
      searchParams: Promise.resolve({ approval: id, kind: 'lifecycle' }),
    })
  );
  expect(
    screen.getByRole('heading', { name: 'Experience receipt' })
  ).toBeVisible();
  expect(screen.queryByTestId('approval')).not.toBeInTheDocument();
});
it('fresh exact-build review stays disabled without installed owner runtime', async () => {
  f.load.mockResolvedValue({
    status: 'confirmation-required',
    merchantId: id,
    buildId: id,
    action: 'rollback',
    effectDigest: 'a'.repeat(64),
    routes: ['/'],
  });
  render(
    await Page({
      searchParams: Promise.resolve({ approval: id, kind: 'lifecycle' }),
    })
  );
  expect(
    JSON.parse(screen.getByTestId('approval').textContent ?? '{}')
  ).toMatchObject({
    approvalId: id,
    merchantId: id,
    buildId: id,
    action: 'rollback',
    enabled: false,
  });
});
it('owner lookup failure does not leak database errors or offer approval', async () => {
  f.load.mockRejectedValue(Error('private details'));
  render(await Page({ searchParams: Promise.resolve({ approval: id }) }));
  expect(
    screen.getByRole('heading', { name: 'Approval unavailable' })
  ).toBeVisible();
  expect(screen.queryByText('private details')).not.toBeInTheDocument();
  expect(screen.queryByTestId('approval')).not.toBeInTheDocument();
});
