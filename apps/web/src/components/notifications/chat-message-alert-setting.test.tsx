import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  mutate: vi.fn(),
  toast: vi.fn(),
}));
vi.mock('@/lib/api-client', () => ({ fetchWithCsrf: mocks.mutate }));
vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

import { ChatMessageAlertSetting } from './chat-message-alert-setting';

const reply = (ok: boolean, body: unknown = {}) => ({
  ok,
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
    ['store is not the chat tenant (404)', () => reply(false)],
    ['response has an unexpected shape', () => reply(true, { other: 1 })],
    [
      'response has an unknown level',
      () => reply(true, { level: 'sometimes' }),
    ],
    [
      'response is the old push switch shape',
      () => reply(true, { push_enabled: true }),
    ],
  ])('renders nothing when the %s', async (_label, make) => {
    mocks.fetch.mockResolvedValue(make());
    const { container } = render(<ChatMessageAlertSetting />);
    await waitFor(() => expect(mocks.fetch).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when loading fails', async () => {
    mocks.fetch.mockRejectedValue(new Error('offline'));
    const { container } = render(<ChatMessageAlertSetting />);
    await waitFor(() => expect(mocks.fetch).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
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
