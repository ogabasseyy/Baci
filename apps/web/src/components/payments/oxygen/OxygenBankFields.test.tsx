import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock('@/lib/api-client', () => ({ fetchWithCsrf: m.fetch }));

import { OxygenBankFields } from './OxygenBankFields';

const id = '60000000-0000-4000-8000-000000000001';
beforeEach(() => {
  vi.resetAllMocks();
  HTMLElement.prototype.scrollIntoView = vi.fn();
  HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
  HTMLElement.prototype.releasePointerCapture = vi.fn();
  m.fetch.mockImplementation(async (_url: string, options: RequestInit) =>
    JSON.parse(String(options.body)).action === 'banks'
      ? Response.json({
          banks: [
            { name: 'Test bank', code: '001' },
            { name: 'Other bank', code: '002' },
          ],
        })
      : Response.json({ accountName: 'TEST CUSTOMER' })
  );
});
it('selects bank code/name and resolves the account name without asking users to type them', async () => {
  render(<OxygenBankFields workflowId={id} busy={false} />);
  await waitFor(() => expect(screen.getByLabelText('Bank')).toBeEnabled());
  fireEvent.keyDown(screen.getByLabelText('Bank'), { key: 'Enter' });
  fireEvent.click(await screen.findByRole('option', { name: 'Test bank' }));
  fireEvent.change(screen.getByLabelText('Account number'), {
    target: { value: '0123456789' },
  });
  await waitFor(() =>
    expect(screen.getByLabelText('Account name')).toHaveValue('TEST CUSTOMER')
  );
  expect(screen.getByLabelText('Account name')).toHaveAttribute('readonly');
  expect(m.fetch.mock.calls[1][1].body).toContain('"bank_code":"001"');
  fireEvent.change(screen.getByLabelText('Account number'), {
    target: { value: '0123456780' },
  });
  expect(screen.getByLabelText('Account name')).toHaveValue('');
});
it('ignores a late lookup after the account number changes', async () => {
  let finish: (r: Response) => void = () => {};
  const pending = new Promise<Response>((r) => {
    finish = r;
  });
  m.fetch.mockImplementation(async (_url: string, o: RequestInit) =>
    JSON.parse(String(o.body)).action === 'banks'
      ? Response.json({ banks: [{ name: 'Test bank', code: '001' }] })
      : pending
  );
  render(<OxygenBankFields workflowId={id} busy={false} />);
  await waitFor(() => expect(screen.getByLabelText('Bank')).toBeEnabled());
  fireEvent.keyDown(screen.getByLabelText('Bank'), { key: 'Enter' });
  fireEvent.click(await screen.findByRole('option', { name: 'Test bank' }));
  fireEvent.change(screen.getByLabelText('Account number'), {
    target: { value: '0123456789' },
  });
  fireEvent.change(screen.getByLabelText('Account number'), {
    target: { value: '012345678' },
  });
  await act(async () => {
    finish(Response.json({ accountName: 'OLD ACCOUNT' }));
    await pending;
  });
  await waitFor(() =>
    expect(screen.queryByDisplayValue('OLD ACCOUNT')).toBeNull()
  );
  expect(screen.getByLabelText('Account name')).toHaveValue('');
});
it('shows lookup failure and leaves the account unverified', async () => {
  m.fetch.mockResolvedValue(
    Response.json({ error: 'private provider error' }, { status: 503 })
  );
  render(<OxygenBankFields workflowId={id} busy={false} />);
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Unable to load banks'
  );
  expect(screen.queryByText('private provider error')).toBeNull();
});

it('waits for ten digits and verifies when the bank is selected last', async () => {
  render(<OxygenBankFields workflowId={id} busy={false} />);
  await waitFor(() => expect(screen.getByLabelText('Bank')).toBeEnabled());
  fireEvent.change(screen.getByLabelText('Account number'), {
    target: { value: '012345678' },
  });
  expect(m.fetch).toHaveBeenCalledTimes(1);
  fireEvent.change(screen.getByLabelText('Account number'), {
    target: { value: '0123456789' },
  });
  expect(m.fetch).toHaveBeenCalledTimes(1);
  fireEvent.keyDown(screen.getByLabelText('Bank'), { key: 'Enter' });
  fireEvent.click(await screen.findByRole('option', { name: 'Test bank' }));
  await waitFor(() =>
    expect(screen.getByLabelText('Account name')).toHaveValue('TEST CUSTOMER')
  );
  expect(m.fetch).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole('button', { name: 'Verify account' })).toBeNull();
});
it('offers a retry after an automatic lookup fails', async () => {
  m.fetch.mockImplementation(async (_url: string, options: RequestInit) =>
    JSON.parse(String(options.body)).action === 'banks'
      ? Response.json({ banks: [{ name: 'Test bank', code: '001' }] })
      : Response.json({}, { status: 503 })
  );
  render(<OxygenBankFields workflowId={id} busy={false} />);
  await waitFor(() => expect(screen.getByLabelText('Bank')).toBeEnabled());
  fireEvent.keyDown(screen.getByLabelText('Bank'), { key: 'Enter' });
  fireEvent.click(await screen.findByRole('option', { name: 'Test bank' }));
  fireEvent.change(screen.getByLabelText('Account number'), {
    target: { value: '0123456789' },
  });
  const retry = await screen.findByRole('button', { name: 'Try again' });
  m.fetch.mockResolvedValue(Response.json({ accountName: 'TEST CUSTOMER' }));
  fireEvent.click(retry);
  await waitFor(() =>
    expect(screen.getByLabelText('Account name')).toHaveValue('TEST CUSTOMER')
  );
});

it('does not verify hidden steps or while busy and starts when the bank step is active', async () => {
  const defaults = { bank_code: '001', account_number: '0123456789' };
  const view = render(
    <OxygenBankFields
      workflowId={id}
      busy={false}
      active={false}
      defaults={defaults}
    />
  );
  await waitFor(() => expect(screen.getByLabelText('Bank')).toBeEnabled());
  expect(m.fetch).toHaveBeenCalledTimes(1);
  view.rerender(
    <OxygenBankFields workflowId={id} busy={true} active defaults={defaults} />
  );
  expect(m.fetch).toHaveBeenCalledTimes(1);
  view.rerender(
    <OxygenBankFields workflowId={id} busy={false} active defaults={defaults} />
  );
  await waitFor(() =>
    expect(screen.getByLabelText('Account name')).toHaveValue('TEST CUSTOMER')
  );
});
