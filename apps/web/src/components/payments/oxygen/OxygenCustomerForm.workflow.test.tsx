import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock('@/lib/api-client', () => ({ fetchWithCsrf: api.fetch }));
vi.mock('./use-oxygen-draft', () => ({
  useOxygenDraft: () => ({
    initial: {
      step: 1,
      fields: { bank_code: '001', account_number: '0123456789' },
    },
    ready: true,
    status: 'saved',
    queue: vi.fn(),
    flush: vi.fn(async () => true),
    retry: vi.fn(),
  }),
}));

import { OxygenCustomerForm } from './OxygenCustomerForm';

beforeEach(() => {
  vi.resetAllMocks();
  HTMLElement.prototype.scrollIntoView = vi.fn();
  HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
  HTMLElement.prototype.releasePointerCapture = vi.fn();
});

it('requires bank verification again when the application changes', async () => {
  const firstWorkflow = '108497c7-a91c-4f72-b3cf-410ed6800fb3';
  const secondWorkflow = '208497c7-a91c-4f72-b3cf-410ed6800fb3';
  let finishSecond: (response: Response) => void = () => {};
  const secondLookup = new Promise<Response>((resolve) => {
    finishSecond = resolve;
  });
  api.fetch.mockImplementation(async (_url: string, options: RequestInit) => {
    const request = JSON.parse(String(options.body));
    if (request.action === 'banks')
      return Response.json({ banks: [{ code: '001', name: 'Test bank' }] });
    return request.workflowId === firstWorkflow
      ? Response.json({ accountName: 'FIRST CUSTOMER' })
      : secondLookup;
  });
  const props = { phone: '08000000001', busy: false, submit: vi.fn() };
  const view = render(
    <OxygenCustomerForm {...props} workflowId={firstWorkflow} />
  );
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Continue to income details' })
    ).toBeEnabled()
  );

  view.rerender(<OxygenCustomerForm {...props} workflowId={secondWorkflow} />);
  await screen.findByText('Checking your account');
  expect(screen.getByLabelText('Account name')).toHaveValue('');
  expect(
    screen.getByRole('button', { name: 'Continue to income details' })
  ).toBeDisabled();

  await act(async () =>
    finishSecond(Response.json({ accountName: 'SECOND CUSTOMER' }))
  );
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Continue to income details' })
    ).toBeEnabled()
  );
});
