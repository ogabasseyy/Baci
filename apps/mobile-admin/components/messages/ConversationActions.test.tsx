import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { Alert } from 'react-native';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LIGHT_COLORS } from '@/constants/theme';
import type { InboxConversation } from '@/schemas/merchant-inbox';

const mocks = vi.hoisted(() => ({ choose: vi.fn() }));
vi.mock('@/components/ui/showChoiceSheet', () => ({
  showChoiceSheet: mocks.choose,
}));
vi.mock('@/components/ui/AppSheetModal', () => ({
  AppSheetModal: ({
    children,
    visible,
  }: {
    children: ReactNode;
    visible: boolean;
  }) => (visible ? <div>{children}</div> : null),
}));

import { ConversationActions } from './ConversationActions';

const chat = (
  overrides: Partial<InboxConversation> = {}
): InboxConversation => ({
  id: 9,
  status: 'open',
  unreadCount: 0,
  customerName: 'Ada',
  lastActivityAt: null,
  lastMessage: null,
  ...overrides,
});

function renderActions(
  conversation: InboxConversation,
  extra: { busy?: boolean; onUpdate?: () => Promise<unknown> } = {}
) {
  const onUpdate = vi.fn(extra.onUpdate ?? (() => Promise.resolve({})));
  const onDone = vi.fn();
  render(
    <ConversationActions
      busy={extra.busy ?? false}
      colors={LIGHT_COLORS}
      conversation={conversation}
      onDone={onDone}
      onUpdate={onUpdate}
    />
  );
  return { onUpdate, onDone };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(Alert, 'alert').mockImplementation(() => {});
});

describe('ConversationActions', () => {
  it('marks the chat Done and steps back', async () => {
    const { onUpdate, onDone } = renderActions(chat());

    fireEvent.click(screen.getByRole('button', { name: 'Done' }));

    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(onUpdate).toHaveBeenCalledWith({ status: 'resolved' });
  });

  it('offers Reopen on a finished chat and stays on the screen', async () => {
    const { onUpdate, onDone } = renderActions(chat({ status: 'resolved' }));

    fireEvent.click(screen.getByRole('button', { name: 'Reopen' }));

    await waitFor(() =>
      expect(onUpdate).toHaveBeenCalledWith({ status: 'open' })
    );
    expect(onDone).not.toHaveBeenCalled();
  });

  it('warns and stays when Done could not be saved', async () => {
    const { onDone } = renderActions(chat(), {
      onUpdate: () => Promise.reject(new Error('down')),
    });

    fireEvent.click(screen.getByRole('button', { name: 'Done' }));

    await waitFor(() => expect(Alert.alert).toHaveBeenCalled());
    expect(onDone).not.toHaveBeenCalled();
  });

  it('sets a follow-up from the chosen time', async () => {
    mocks.choose.mockResolvedValue('2026-11-23T08:00:00.000Z');
    const { onUpdate } = renderActions(chat());

    fireEvent.click(screen.getByRole('button', { name: 'Follow up' }));

    await waitFor(() =>
      expect(onUpdate).toHaveBeenCalledWith({
        followUpAt: '2026-11-23T08:00:00.000Z',
      })
    );
  });

  it('offers to clear a follow-up that is set, and clears it', async () => {
    mocks.choose.mockResolvedValue('clear');
    const { onUpdate } = renderActions(
      chat({
        followUp: true,
        status: 'snoozed',
        snoozedUntil: '2099-01-02T09:00:00',
      })
    );

    fireEvent.click(screen.getByRole('button', { name: /^Follow up / }));

    await waitFor(() =>
      expect(onUpdate).toHaveBeenCalledWith({ followUpAt: null })
    );
    const options = mocks.choose.mock.calls[0][0].options as {
      value: string;
    }[];
    expect(options.map((o) => o.value)).toContain('clear');
  });

  it('does nothing when the follow-up menu is dismissed', async () => {
    mocks.choose.mockResolvedValue(null);
    const { onUpdate } = renderActions(chat());

    fireEvent.click(screen.getByRole('button', { name: 'Follow up' }));

    await waitFor(() => expect(mocks.choose).toHaveBeenCalled());
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('sets a priority and clears it with No priority', async () => {
    mocks.choose.mockResolvedValueOnce('urgent').mockResolvedValueOnce('none');
    const { onUpdate } = renderActions(chat());

    fireEvent.click(screen.getByRole('button', { name: 'Priority' }));
    await waitFor(() =>
      expect(onUpdate).toHaveBeenCalledWith({ priority: 'urgent' })
    );

    fireEvent.click(screen.getByRole('button', { name: 'Priority' }));
    await waitFor(() =>
      expect(onUpdate).toHaveBeenCalledWith({ priority: null })
    );
  });

  it('shows the current priority and tag count on the buttons', () => {
    renderActions(chat({ priority: 'high', tags: ['lead', 'payment'] }));
    expect(screen.getByRole('button', { name: 'High' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Tags (2)' })
    ).toBeInTheDocument();
  });

  it('opens the tag sheet and adds a quick tag', async () => {
    const { onUpdate } = renderActions(chat());

    fireEvent.click(screen.getByRole('button', { name: 'Tags' }));
    fireEvent.click(screen.getByRole('button', { name: 'Payment' }));

    await waitFor(() =>
      expect(onUpdate).toHaveBeenCalledWith({ addTags: ['Payment'] })
    );
  });

  it('removes a tag that is already on the chat', async () => {
    const { onUpdate } = renderActions(chat({ tags: ['payment'] }));

    fireEvent.click(screen.getByRole('button', { name: 'Tags (1)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Payment, selected' }));

    await waitFor(() =>
      expect(onUpdate).toHaveBeenCalledWith({ removeTags: ['payment'] })
    );
  });

  it('disables the buttons while a change is being saved', () => {
    renderActions(chat(), { busy: true });
    expect(screen.getByRole('button', { name: 'Done' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Priority' })).toBeDisabled();
  });
});
