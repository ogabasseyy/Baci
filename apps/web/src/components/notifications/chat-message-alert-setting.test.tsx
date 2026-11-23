import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  mutate: vi.fn(),
  toast: vi.fn(),
  merchant: vi.fn(),
}));
vi.mock('@/hooks/use-merchant-client', () => ({
  useMerchantSafe: mocks.merchant,
}));
vi.mock('@/lib/api-client', () => ({ fetchWithCsrf: mocks.mutate }));
vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

import { ChatMessageAlertSetting } from './chat-message-alert-setting';

const reply = (
  ok: boolean,
  body: unknown = {},
  status: number = ok ? 200 : 500
) => ({
  ok,
  status,
  json: async () => body,
});
const choice = (name: string | RegExp) => screen.findByRole('radio', { name });
const ALL = /^All new messages/;
const HANDOVER = /^Only when the assistant hands a chat to a person/;
const OFF = /^Off/;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', mocks.fetch);
  mocks.fetch.mockResolvedValue(reply(true, { level: 'all' }));
  mocks.merchant.mockReturnValue(null);
});

describe('ChatMessageAlertSetting', () => {
  it('offers the three choices in plain words with the stored one selected', async () => {
    mocks.fetch.mockResolvedValue(reply(true, { level: 'handover' }));
    render(<ChatMessageAlertSetting />);
    expect(await choice(HANDOVER)).toBeChecked();
    expect(screen.getByRole('radio', { name: ALL })).not.toBeChecked();
    expect(screen.getByRole('radio', { name: OFF })).not.toBeChecked();
    expect(screen.getByText('Customer Chat Alerts')).toBeInTheDocument();
  });

  it.each([
    ['store is not the chat tenant (404)', () => reply(false, {}, 404)],
    ['person may not view it (403)', () => reply(false, {}, 403)],
    ['person is signed out (401)', () => reply(false, {}, 401)],
  ])('renders nothing when the %s', async (_label, make) => {
    mocks.fetch.mockResolvedValue(make());
    const { container } = render(<ChatMessageAlertSetting />);
    await waitFor(() => expect(mocks.fetch).toHaveBeenCalled());
    await waitFor(() => expect(container).toBeEmptyDOMElement());
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  describe('bugfix: a failed load must not silently remove the control', () => {
    it.each([
      ['the server fails (500)', () => reply(false, {}, 500)],
      ['the response has an unexpected shape', () => reply(true, { other: 1 })],
      [
        'the response has an unknown level',
        () => reply(true, { level: 'sometimes' }),
      ],
      [
        'the response is the old push switch shape',
        () => reply(true, { push_enabled: true }),
      ],
    ])('offers a retry when %s', async (_label, make) => {
      mocks.fetch.mockResolvedValueOnce(make());
      render(<ChatMessageAlertSetting />);
      const retry = await screen.findByRole('button', { name: 'Try again' });
      expect(screen.getByText(/could not load/i)).toBeInTheDocument();

      await userEvent.click(retry);
      expect(await choice(ALL)).toBeChecked();
      expect(mocks.fetch).toHaveBeenCalledTimes(2);
      expect(
        screen.queryByRole('button', { name: 'Try again' })
      ).not.toBeInTheDocument();
    });

    it('offers a retry when the network is down', async () => {
      mocks.fetch.mockRejectedValueOnce(new Error('offline'));
      render(<ChatMessageAlertSetting />);
      expect(
        await screen.findByRole('button', { name: 'Try again' })
      ).toBeInTheDocument();
    });

    it('keeps the current choice on screen, locked, while another store loads', async () => {
      const A = '123e4567-e89b-12d3-a456-426614174001';
      const B = '123e4567-e89b-12d3-a456-426614174002';
      mocks.merchant.mockReturnValue({ merchant: { id: A } });
      mocks.fetch.mockResolvedValueOnce(reply(true, { level: 'all' }));
      const { rerender } = render(<ChatMessageAlertSetting />);
      expect(await choice(ALL)).toBeChecked();

      let finish: (value: unknown) => void = () => {};
      mocks.fetch.mockReturnValueOnce(
        new Promise((resolve) => {
          finish = resolve;
        })
      );
      mocks.merchant.mockReturnValue({ merchant: { id: B } });
      rerender(<ChatMessageAlertSetting />);

      expect(screen.getByRole('radio', { name: ALL })).toBeDisabled();
      finish(reply(true, { level: 'off' }));
      await waitFor(() =>
        expect(screen.getByRole('radio', { name: OFF })).toBeChecked()
      );
      expect(screen.getByRole('radio', { name: OFF })).toBeEnabled();
    });
  });

  it('saves "only when the assistant hands a chat to a person" and keeps the saved value', async () => {
    mocks.mutate.mockResolvedValue(reply(true, { level: 'handover' }));
    render(<ChatMessageAlertSetting />);
    await userEvent.click(await choice(HANDOVER));

    expect(mocks.mutate).toHaveBeenCalledWith(
      '/api/merchant/chat-notifications',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ level: 'handover' }),
      })
    );
    await waitFor(() =>
      expect(screen.getByRole('radio', { name: HANDOVER })).toBeChecked()
    );
  });

  it('saves off', async () => {
    mocks.mutate.mockResolvedValue(reply(true, { level: 'off' }));
    render(<ChatMessageAlertSetting />);
    await userEvent.click(await choice(OFF));
    expect(mocks.mutate).toHaveBeenCalledWith(
      '/api/merchant/chat-notifications',
      expect.objectContaining({ body: JSON.stringify({ level: 'off' }) })
    );
    await waitFor(() =>
      expect(screen.getByRole('radio', { name: OFF })).toBeChecked()
    );
  });

  describe('bugfix: acts on the store the dashboard has selected', () => {
    const SELECTED = '123e4567-e89b-12d3-a456-426614174001';

    it('reads the choice for the selected store', async () => {
      mocks.merchant.mockReturnValue({ merchant: { id: SELECTED } });
      render(<ChatMessageAlertSetting />);
      await choice(ALL);
      expect(mocks.fetch).toHaveBeenCalledWith(
        '/api/merchant/chat-notifications',
        { headers: { 'x-baci-merchant-id': SELECTED } }
      );
    });

    it('saves the choice for the selected store', async () => {
      mocks.merchant.mockReturnValue({ merchant: { id: SELECTED } });
      mocks.mutate.mockResolvedValue(reply(true, { level: 'off' }));
      render(<ChatMessageAlertSetting />);
      await userEvent.click(await choice(OFF));
      expect(mocks.mutate).toHaveBeenCalledWith(
        '/api/merchant/chat-notifications',
        expect.objectContaining({
          headers: {
            'Content-Type': 'application/json',
            'x-baci-merchant-id': SELECTED,
          },
        })
      );
    });

    it('sends no store header when there is no merchant context', async () => {
      render(<ChatMessageAlertSetting />);
      await choice(ALL);
      expect(mocks.fetch).toHaveBeenCalledWith(
        '/api/merchant/chat-notifications',
        { headers: undefined }
      );
    });
  });

  it('does not save again when the current choice is picked', async () => {
    render(<ChatMessageAlertSetting />);
    await userEvent.click(await choice(ALL));
    expect(mocks.mutate).not.toHaveBeenCalled();
  });

  it('puts the choice back and tells the merchant when saving fails', async () => {
    mocks.mutate.mockResolvedValue(reply(false));
    render(<ChatMessageAlertSetting />);
    await userEvent.click(await choice(OFF));

    await waitFor(() =>
      expect(mocks.toast).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Could not save' })
      )
    );
    expect(screen.getByRole('radio', { name: ALL })).toBeChecked();
    expect(screen.getByRole('radio', { name: OFF })).not.toBeChecked();
  });

  it('puts the choice back when the server answers with something else', async () => {
    mocks.mutate.mockResolvedValue(reply(true, { level: 'nonsense' }));
    render(<ChatMessageAlertSetting />);
    await userEvent.click(await choice(HANDOVER));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalled());
    expect(screen.getByRole('radio', { name: ALL })).toBeChecked();
  });
});
