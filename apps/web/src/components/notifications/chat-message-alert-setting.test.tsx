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
const toggle = () =>
  screen.findByRole('switch', { name: 'Customer chat alerts' });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', mocks.fetch);
  mocks.fetch.mockResolvedValue(reply(true, { push_enabled: true }));
});

describe('ChatMessageAlertSetting', () => {
  it('shows the stored switch state', async () => {
    mocks.fetch.mockResolvedValue(reply(true, { push_enabled: false }));
    render(<ChatMessageAlertSetting />);
    expect(await toggle()).not.toBeChecked();
  });

  it.each([
    ['store is not the chat tenant (404)', () => reply(false)],
    ['response has an unexpected shape', () => reply(true, { other: 1 })],
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

  it('saves a change and keeps the saved value', async () => {
    mocks.mutate.mockResolvedValue(reply(true, { push_enabled: false }));
    render(<ChatMessageAlertSetting />);
    await userEvent.click(await toggle());

    expect(mocks.mutate).toHaveBeenCalledWith(
      '/api/merchant/chat-notifications',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ push_enabled: false }),
      })
    );
    await waitFor(() => expect(screen.getByRole('switch')).not.toBeChecked());
  });

  it('puts the switch back and tells the merchant when saving fails', async () => {
    mocks.mutate.mockResolvedValue(reply(false));
    render(<ChatMessageAlertSetting />);
    await userEvent.click(await toggle());

    await waitFor(() =>
      expect(mocks.toast).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Could not save' })
      )
    );
    expect(screen.getByRole('switch')).toBeChecked();
  });
});
