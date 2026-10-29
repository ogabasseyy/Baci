import { describe, expect, it } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Linking } from 'react-native';
import { ChatMessageRow } from './ChatMessageRow';
import type { ChatMessage } from './types';

const colors = {
  border: '#DDDDDD',
  card: '#FFFFFF',
  muted: '#F2F2F2',
  text: '#111111',
};

const baseMessage: ChatMessage = {
  id: 'message-1',
  role: 'model',
  text: 'How can I help?',
  timestamp: new Date('2026-05-01T00:00:00.000Z'),
};

describe('ChatMessageRow', () => {
  it('renders the AI avatar for assistant messages', () => {
    const { UNSAFE_getByProps } = render(
      <ChatMessageRow item={baseMessage} santaMode={false} colors={colors} />
    );

    expect(screen.getByText('How can I help?')).toBeOnTheScreen();
    expect(UNSAFE_getByProps({ children: '✨' })).toBeTruthy();
  });

  it('renders user messages without the AI avatar', () => {
    render(
      <ChatMessageRow
        item={{ ...baseMessage, role: 'user', text: 'Show me phones' }}
        santaMode={false}
        colors={colors}
      />
    );

    expect(screen.getByText('Show me phones')).toBeOnTheScreen();
    expect(screen.queryByText('✨')).toBeNull();
  });

  it('keeps user messages avatar-free in santa mode', () => {
    render(
      <ChatMessageRow
        item={{ ...baseMessage, role: 'user', text: 'Show me phones' }}
        santaMode={true}
        colors={colors}
      />
    );

    expect(screen.getByText('Show me phones')).toBeOnTheScreen();
    expect(screen.queryByText('✨')).toBeNull();
    expect(screen.queryByText('🎅')).toBeNull();
  });

  it('uses the Santa avatar in santa mode', () => {
    const { UNSAFE_getByProps } = render(
      <ChatMessageRow item={baseMessage} santaMode={true} colors={colors} />
    );

    expect(UNSAFE_getByProps({ children: '🎅' })).toBeTruthy();
  });

  it('opens verified storefront product links in assistant messages', () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    const url = 'https://ogabassey.com/smartphones/iphone-16';
    render(
      <ChatMessageRow
        item={{ ...baseMessage, text: `Choose a product: ${url}` }}
        santaMode={false}
        colors={colors}
      />
    );
    fireEvent.press(screen.getByRole('link', { name: url }));
    expect(open).toHaveBeenCalledWith(url);
    open.mockRestore();
  });

  it('keeps sentence punctuation out of storefront link targets', () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    const phone = 'https://ogabassey.com/smartphones/iphone-16';
    const charger = 'https://ogabassey.com/accessories/charger';
    render(
      <ChatMessageRow
        item={{ ...baseMessage, text: `See (${phone}), or ${charger}.` }}
        santaMode={false}
        colors={colors}
      />
    );
    expect(
      screen.getByText(`See (${phone}), or ${charger}.`)
    ).toBeOnTheScreen();
    fireEvent.press(screen.getByRole('link', { name: phone }));
    fireEvent.press(screen.getByRole('link', { name: charger }));
    expect(open).toHaveBeenNthCalledWith(1, phone);
    expect(open).toHaveBeenNthCalledWith(2, charger);
    open.mockRestore();
  });

  it('preserves balanced parentheses in a storefront link', () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    const url = 'https://ogabassey.com/search?q=charger(20W)';
    render(
      <ChatMessageRow
        item={{ ...baseMessage, text: `See (${url}).` }}
        santaMode={false}
        colors={colors}
      />
    );
    expect(screen.getByText(`See (${url}).`)).toBeOnTheScreen();
    fireEvent.press(screen.getByRole('link', { name: url }));
    expect(open).toHaveBeenCalledWith(url);
    open.mockRestore();
  });

  it('does not turn lookalike URLs into links', () => {
    render(
      <ChatMessageRow
        item={{
          ...baseMessage,
          text: 'https://ogabassey.com.evil.example/product',
        }}
        santaMode={false}
        colors={colors}
      />
    );
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('does not turn a user-provided storefront URL into a link', () => {
    render(
      <ChatMessageRow
        item={{
          ...baseMessage,
          role: 'user',
          text: 'https://ogabassey.com/account/orders',
        }}
        santaMode={false}
        colors={colors}
      />
    );
    expect(screen.queryByRole('link')).toBeNull();
  });
});
