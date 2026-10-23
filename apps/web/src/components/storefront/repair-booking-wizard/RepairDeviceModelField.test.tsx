import { fireEvent, render, screen } from '@testing-library/react';
import type { ControllerRenderProps } from 'react-hook-form';
import { describe, expect, it, vi } from 'vitest';
import type { z } from 'zod';
import type { repairBookingSchema } from '@/lib/validations/repair';
import { RepairDeviceModelField } from './RepairDeviceModelField';
import { useRepairDeviceSuggestions } from './useRepairDeviceSuggestions';

vi.mock('./useRepairDeviceSuggestions', () => ({
  useRepairDeviceSuggestions: vi.fn(),
}));

const mockedSuggestionsHook = vi.mocked(useRepairDeviceSuggestions);

function setEmptySuggestions(refreshSuggestions = vi.fn()) {
  mockedSuggestionsHook.mockReturnValue({
    clearSuggestions: vi.fn(),
    hasSearched: false,
    isLoading: false,
    lookupFailed: false,
    refreshSuggestions,
    suggestions: [],
  });
  return refreshSuggestions;
}

describe('RepairDeviceModelField', () => {
  it('exposes a labeled device model combobox when catalog suggestions are enabled', () => {
    setEmptySuggestions();
    const field: ControllerRenderProps<
      z.input<typeof repairBookingSchema>,
      'deviceModel'
    > = {
      name: 'deviceModel',
      value: '',
      onBlur: vi.fn(),
      onChange: vi.fn(),
      ref: vi.fn(),
    };

    render(
      <RepairDeviceModelField
        catalogEnabled
        field={field}
        id="device-model"
        merchantSlug="ogabassey"
        onDeviceChange={vi.fn()}
        onSelectDevice={vi.fn()}
      />
    );

    expect(screen.getByRole('combobox')).toHaveAttribute(
      'aria-autocomplete',
      'list'
    );
    fireEvent.change(screen.getByRole('combobox'), {
      target: { value: 'iPhone' },
    });
    expect(field.onChange).toHaveBeenCalled();
  });

  it('refreshes suggestions when the unchanged model field regains focus', () => {
    const refreshSuggestions = setEmptySuggestions();
    const field: ControllerRenderProps<
      z.input<typeof repairBookingSchema>,
      'deviceModel'
    > = {
      name: 'deviceModel',
      value: 'iPhone 15',
      onBlur: vi.fn(),
      onChange: vi.fn(),
      ref: vi.fn(),
    };

    render(
      <RepairDeviceModelField
        catalogEnabled
        field={field}
        merchantSlug="ogabassey"
        onDeviceChange={vi.fn()}
        onSelectDevice={vi.fn()}
      />
    );

    fireEvent.focus(screen.getByRole('combobox'));

    expect(refreshSuggestions).toHaveBeenCalledTimes(1);
  });
});
