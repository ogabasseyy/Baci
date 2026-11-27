import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LIGHT_COLORS } from '@/constants/theme';
import { inboxAvatar } from '@/lib/merchant-inbox-avatar';
import { ConversationAvatar } from './ConversationAvatar';

describe('ConversationAvatar', () => {
  it('shows the face chosen for the name', () => {
    render(
      <ConversationAvatar colors={LIGHT_COLORS} name="small-meadow-890" />
    );

    expect(
      screen.getByText(inboxAvatar('small-meadow-890').emoji)
    ).toBeInTheDocument();
  });

  it('shows the same face again for the same name', () => {
    const { unmount } = render(
      <ConversationAvatar colors={LIGHT_COLORS} name="Ada Obi" />
    );
    const first = inboxAvatar('Ada Obi').emoji;
    expect(screen.getByText(first)).toBeInTheDocument();
    unmount();

    render(<ConversationAvatar colors={LIGHT_COLORS} name="Ada Obi" />);
    expect(screen.getByText(first)).toBeInTheDocument();
  });
});
