import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { LIGHT_COLORS } from '@/constants/theme';

const scroll = vi.hoisted(() => ({
  props: null as Record<string, unknown> | null,
}));

vi.mock('react-native', async () => {
  const actual =
    await vi.importActual<typeof import('react-native')>('react-native');
  return {
    ...actual,
    ScrollView: (props: Record<string, unknown>) => {
      scroll.props = props;
      return null;
    },
  };
});
vi.mock('@/components/ui/AppSheetModal', () => ({
  AppSheetModal: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
}));

import { ConversationActions } from './ConversationActions';

describe('bugfix: the action bar works while the reply keyboard is open', () => {
  it('lets a tap reach Done, Follow up, Priority and Tags instead of only closing the keyboard', () => {
    render(
      <ConversationActions
        busy={false}
        colors={LIGHT_COLORS}
        conversation={{
          id: 9,
          status: 'open',
          unreadCount: 0,
          customerName: 'Ada',
          lastActivityAt: null,
          lastMessage: null,
        }}
        onDone={vi.fn()}
        onUpdate={vi.fn()}
      />
    );

    // With the default ("never"), the first tap only dismisses the keyboard.
    expect(scroll.props?.keyboardShouldPersistTaps).toBe('handled');
  });
});
