import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LIGHT_COLORS } from '@/constants/theme';
import { FloatingSearchBar } from './FloatingSearchBar';

describe('FloatingSearchBar', () => {
  it('reports what is typed', () => {
    const onChangeText = vi.fn();
    render(
      <FloatingSearchBar
        colors={LIGHT_COLORS}
        onChangeText={onChangeText}
        value=""
      />
    );

    fireEvent.change(screen.getByLabelText('Search chats'), {
      target: { value: 'ada' },
    });

    expect(onChangeText).toHaveBeenCalledWith('ada');
  });

  it('offers a clear button only when there is text, and clears', () => {
    const onChangeText = vi.fn();
    const { rerender } = render(
      <FloatingSearchBar
        colors={LIGHT_COLORS}
        onChangeText={onChangeText}
        value=""
      />
    );
    expect(screen.queryByRole('button', { name: 'Clear search' })).toBeNull();

    rerender(
      <FloatingSearchBar
        colors={LIGHT_COLORS}
        onChangeText={onChangeText}
        value="ada"
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));

    expect(onChangeText).toHaveBeenCalledWith('');
  });

  it('caps the length of a search at 100 characters', () => {
    render(
      <FloatingSearchBar
        colors={LIGHT_COLORS}
        onChangeText={vi.fn()}
        value=""
      />
    );
    expect(screen.getByLabelText('Search chats')).toHaveAttribute(
      'maxlength',
      '100'
    );
  });

  it('has a solid field, so what is typed stays readable', () => {
    render(
      <FloatingSearchBar
        colors={LIGHT_COLORS}
        onChangeText={vi.fn()}
        value=""
      />
    );

    const pill = screen.getByLabelText('Search chats').parentElement;
    const fill = pill ? getComputedStyle(pill).backgroundColor : '';

    // The card colour, fully opaque (no alpha channel).
    expect(fill).toBe('rgb(255, 255, 255)');
  });
});
