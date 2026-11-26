import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CountryPickerDialog } from './CountryPickerDialog';

describe('CountryPickerDialog', () => {
  it('filters countries by search text and invokes onSelectCountry', () => {
    const onSelectCountry = vi.fn();
    render(
      <CountryPickerDialog
        open
        onOpenChange={vi.fn()}
        onSelectCountry={onSelectCountry}
      />
    );

    fireEvent.change(screen.getByLabelText('Search countries'), {
      target: { value: 'nigeria' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Nigeria/i }));

    expect(onSelectCountry).toHaveBeenCalledWith('NG', 'Nigeria');
  });
});
