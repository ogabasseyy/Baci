import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LIGHT_COLORS } from '@/constants/theme';
import { NewCustomerAddressSuggestions } from './NewCustomerAddressSuggestions';

vi.mock('react-native', async () => {
  const React = await import('react');
  const element =
    (tag: string) =>
    ({
      children,
      style: _style,
      ...props
    }: {
      children?: React.ReactNode;
      style?: unknown;
      [key: string]: unknown;
    }) =>
      React.createElement(tag, props, children);
  return {
    Pressable: ({
      children,
      onPress,
      style: _style,
      ...props
    }: {
      children?: React.ReactNode;
      onPress?: () => void;
      style?: unknown;
      [key: string]: unknown;
    }) =>
      React.createElement('button', { ...props, onClick: onPress }, children),
    Text: element('span'),
    View: element('div'),
  };
});

describe('NewCustomerAddressSuggestions', () => {
  it('renders and selects a suggestion', () => {
    const onSelect = vi.fn();
    const suggestion = {
      description: '12 Allen Avenue, Accra',
      mainText: '12 Allen Avenue',
      placeId: 'place-1',
      secondaryText: 'Accra',
    };
    render(
      <NewCustomerAddressSuggestions
        colors={LIGHT_COLORS}
        onSelect={onSelect}
        suggestions={[suggestion]}
      />
    );
    fireEvent.click(screen.getByRole('button'));
    expect(onSelect).toHaveBeenCalledWith(suggestion);
  });
});
