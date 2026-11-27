import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { Alert } from 'react-native';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LIGHT_COLORS, SPACING } from '@/constants/theme';
import type { InboxConversation } from '@/schemas/merchant-inbox';

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
  it('bugfix: every action button is tall enough to tap', () => {
    renderActions(chat());

    for (const button of screen.getAllByRole('button')) {
      expect(button).toHaveStyle({ minHeight: `${SPACING.touchTarget}px` });
    }
  });

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
    const { onUpdate } = renderActions(chat());

    fireEvent.click(screen.getByRole('button', { name: 'Follow up' }));
    fireEvent.click(screen.getByRole('button', { name: 'Tomorrow morning' }));

    await waitFor(() =>
      expect(onUpdate).toHaveBeenCalledWith({
        followUpAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      })
    );
  });

  it('bugfix: shows every follow-up choice, including the last, and Clear when set', async () => {
    const { onUpdate } = renderActions(
      chat({
        followUp: true,
        status: 'snoozed',
        snoozedUntil: '2099-01-02T09:00:00',
      })
    );

    fireEvent.click(screen.getByRole('button', { name: /^Follow up / }));

    for (const label of [
      'In 3 hours',
      'Tomorrow morning',
      'In 3 days',
      'Next week',
      'Clear follow-up',
    ]) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
    fireEvent.click(screen.getByRole('button', { name: 'Clear follow-up' }));
    await waitFor(() =>
      expect(onUpdate).toHaveBeenCalledWith({ followUpAt: null })
    );
  });

  it('does not offer Clear when no follow-up is set', () => {
    renderActions(chat());
    fireEvent.click(screen.getByRole('button', { name: 'Follow up' }));
    expect(
      screen.queryByRole('button', { name: 'Clear follow-up' })
    ).toBeNull();
  });

  it('does nothing when the menu is dismissed', () => {
    const { onUpdate } = renderActions(chat());

    fireEvent.click(screen.getByRole('button', { name: 'Follow up' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onUpdate).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'In 3 days' })).toBeNull();
  });

  it('bugfix: offers all five priorities, not only the first three', async () => {
    const { onUpdate } = renderActions(chat());

    fireEvent.click(screen.getByRole('button', { name: 'Priority' }));
    for (const label of ['Urgent', 'High', 'Medium', 'Low', 'No priority']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }

    fireEvent.click(screen.getByRole('button', { name: 'Low' }));
    await waitFor(() =>
      expect(onUpdate).toHaveBeenCalledWith({ priority: 'low' })
    );

    fireEvent.click(screen.getByRole('button', { name: 'Priority' }));
    fireEvent.click(screen.getByRole('button', { name: 'No priority' }));
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

  it('warns when removing a tag could not be saved', async () => {
    renderActions(chat({ tags: ['payment'] }), {
      onUpdate: () => Promise.reject(new Error('down')),
    });

    fireEvent.click(screen.getByRole('button', { name: 'Tags (1)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Payment, selected' }));

    await waitFor(() =>
      expect(Alert.alert).toHaveBeenCalledWith(
        'Could not save',
        expect.any(String)
      )
    );
  });

  it('bugfix: asks for a new time when the chosen follow-up has passed while the sheet was open', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const { onUpdate } = renderActions(chat());

      fireEvent.click(screen.getByRole('button', { name: 'Follow up' }));
      // The sheet stays open past every time it offered.
      vi.setSystemTime(Date.now() + 10 * 24 * 60 * 60 * 1000);
      fireEvent.click(screen.getByRole('button', { name: 'In 3 days' }));

      await waitFor(() =>
        expect(Alert.alert).toHaveBeenCalledWith(
          'That time has passed',
          'Choose a new follow-up time.'
        )
      );
      expect(onUpdate).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('disables the buttons while a change is being saved', () => {
    renderActions(chat(), { busy: true });
    expect(screen.getByRole('button', { name: 'Done' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Priority' })).toBeDisabled();
  });
});
