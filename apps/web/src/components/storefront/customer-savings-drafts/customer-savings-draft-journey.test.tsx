import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { savingsDraftFixture } from '@/lib/customer-savings-draft.test-fixture';
import { customerSavingsDraftView } from '@/lib/customer-savings-draft-view';
import { CustomerSavingsDraftJourney } from './customer-savings-draft-journey';

const mocks = vi.hoisted(() => ({
  catalogue: vi.fn(),
  list: vi.fn(),
  read: vi.fn(),
  create: vi.fn(),
  accept: vi.fn(),
  close: vi.fn(),
  invalidate: () => {},
}));
vi.mock('@/lib/customer-savings-draft-browser', () => ({
  createCustomerSavingsDraftBrowser: (
    _scope: unknown,
    invalidate: () => void
  ) => {
    mocks.invalidate = invalidate;
    return mocks;
  },
}));
vi.mock('@/lib/customer-savings-draft-browser-request-id', () => ({
  customerSavingsDraftBrowserRequestId: async () =>
    '30000000-0000-4000-8000-000000000001',
}));
const fixture = savingsDraftFixture();
const draft = customerSavingsDraftView(fixture.record);
const props = { merchantId: fixture.merchantId, userId: draft.draftId };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.catalogue.mockResolvedValue([
    { ...fixture.record.catalogue, has_variants: true },
  ]);
  mocks.list.mockResolvedValue([]);
  mocks.create.mockResolvedValue(draft);
  mocks.read.mockResolvedValue(draft);
  mocks.accept.mockResolvedValue({
    ...draft,
    consent: 'accepted',
    acceptedAt: '2026-09-13T12:01:00Z',
  });
});
it('completes normal catalogue, draft, read-only disclosure and explicit acceptance', async () => {
  render(<CustomerSavingsDraftJourney {...props} />);
  await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
  fireEvent.change(screen.getByLabelText('Device'), {
    target: { value: draft.productId },
  });
  fireEvent.click(screen.getByRole('radio', { name: /256GB/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Review savings draft' }));
  await screen.findByRole('checkbox');
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm draft terms' }));
  await screen.findByText(/Your draft and consent are saved/);
  fireEvent.click(screen.getByRole('button', { name: 'Back to my drafts' }));
  fireEvent.click(
    screen.getByRole('button', { name: /Open Local test device/ })
  );
  await waitFor(() => expect(mocks.read).toHaveBeenCalledWith(draft.draftId));
});
it('offers retry after catalogue failure and hides private state immediately on logout', async () => {
  mocks.catalogue.mockRejectedValueOnce(new Error('catalogue offline'));
  render(<CustomerSavingsDraftJourney {...props} />);
  await screen.findByRole('alert');
  fireEvent.click(
    screen.getByRole('button', { name: 'Refresh my drafts and devices' })
  );
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  act(() => mocks.invalidate());
  expect(screen.getByText(/session changed/i)).toBeVisible();
  expect(screen.queryByLabelText('Device')).toBeNull();
});

it('distinguishes saved drafts of the same variant by consent and creation time', async () => {
  const accepted = {
    ...draft,
    draftId: draft.requestId,
    createdAt: '2026-09-13T13:00:00Z',
    consent: 'accepted',
    acceptedAt: '2026-09-13T13:01:00Z',
  };
  mocks.list.mockResolvedValue([draft, accepted]);
  render(<CustomerSavingsDraftJourney {...props} />);
  const list = await screen.findByRole('region', { name: 'Saved drafts' });
  const rows = within(list).getAllByRole('listitem');
  expect(within(rows[0]).getByText('Needs your consent')).toBeVisible();
  expect(within(rows[1]).getByText('Consent saved')).toBeVisible();
  expect(rows[0].querySelector('time')).toHaveAttribute(
    'datetime',
    draft.createdAt
  );
  expect(rows[1].querySelector('time')).toHaveAttribute(
    'datetime',
    accepted.createdAt
  );
  fireEvent.click(within(rows[1]).getByRole('button'));
  await waitFor(() =>
    expect(mocks.read).toHaveBeenCalledWith(accepted.draftId)
  );
});
