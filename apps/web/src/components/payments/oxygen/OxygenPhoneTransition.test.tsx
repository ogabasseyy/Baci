import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock('@/lib/api-client', () => ({ fetchWithCsrf: mocks.fetch }));
vi.mock('@/lib/posthog/capture-client-event', () => ({
  captureClientEvent: vi.fn(),
}));

import { OxygenProviderFlow } from './OxygenProviderFlow';

beforeAll(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
});
afterAll(() => vi.unstubAllGlobals());

it('keeps the phone success animation mounted before starting identity checks', async () => {
  const id = '60000000-0000-4000-8000-000000000001';
  const snapshot = {
    workflowId: id,
    stage: 'eligibility_required',
    version: 1,
    environment: 'staging',
    executionEnabled: true,
    state: {},
    approvalOtpReady: false,
    activationEnabled: false,
    settlementEnabled: false,
  };
  let accept: (response: Response) => void = () => {};
  mocks.fetch.mockImplementation((url: string, options?: RequestInit) => {
    if (url.includes('/actions') && options?.method === 'POST') {
      const action = JSON.parse(String(options.body)).command.action;
      if (action === 'validate_customer')
        return new Promise<Response>((resolve) => {
          accept = resolve;
        });
      return new Promise<Response>(() => {});
    }
    return Promise.resolve(
      Response.json(url.includes('?') ? snapshot : { workflow: { id } })
    );
  });
  const view = render(<OxygenProviderFlow orderId={id} />);
  const input = await screen.findByLabelText('Verification code');
  fireEvent.change(input, { target: { value: '123456' } });
  await waitFor(() =>
    expect(
      mocks.fetch.mock.calls.some(([, opts]) =>
        String(opts?.body).includes('validate_customer')
      )
    ).toBe(true)
  );
  await act(async () => {
    accept(
      Response.json({ ...snapshot, version: 2, state: { validated: true } })
    );
  });
  await waitFor(() => expect(screen.getByText('Code verified.')).toBeVisible());
  expect(
    screen.getByRole('heading', { name: 'Verify your phone' })
  ).toBeVisible();
  expect(screen.queryByText('Checking your BVN')).toBeNull();
  await waitFor(
    () =>
      expect(
        screen.queryByRole('heading', { name: 'Verify your phone' })
      ).toBeNull(),
    { timeout: 1500 }
  );
  expect(
    screen.getByRole('heading', {
      name: /Checking your BVN|Checking your payment options/,
    })
  ).toBeVisible();
  view.unmount();
});
