import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SearchAutocompleteClearButton } from './search-autocomplete-clear-button';

describe('SearchAutocompleteClearButton', () => {
  it('invokes the clear handler when pressed', () => {
    const onClear = vi.fn();

    render(<SearchAutocompleteClearButton onClear={onClear} />);

    fireEvent.click(screen.getByRole('button', { name: /clear search/i }));

    expect(onClear).toHaveBeenCalledTimes(1);
  });
});
