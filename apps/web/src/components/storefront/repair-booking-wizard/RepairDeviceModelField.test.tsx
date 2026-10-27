import { fireEvent, render, screen } from '@testing-library/react';
import type { ControllerRenderProps } from 'react-hook-form';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { z } from 'zod';
import type { repairBookingSchema } from '@/lib/validations/repair';
import { RepairDeviceModelField } from './RepairDeviceModelField';
import { useRepairDeviceSuggestions } from './useRepairDeviceSuggestions';

vi.mock('./useRepairDeviceSuggestions', () => ({
  useRepairDeviceSuggestions: vi.fn(),
}));

const mockedSuggestionsHook = vi.mocked(useRepairDeviceSuggestions);
const originalScrollIntoView = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  'scrollIntoView'
);

afterEach(() => {
  if (originalScrollIntoView) {
    Object.defineProperty(
      HTMLElement.prototype,
      'scrollIntoView',
      originalScrollIntoView
    );
  } else {
    Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
  }
});

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
  it('uses unique listbox IDs for each picker instance', () => {
    mockedSuggestionsHook.mockReturnValue({
      clearSuggestions: vi.fn(),
      hasSearched: true,
      isLoading: false,
      lookupFailed: false,
      refreshSuggestions: vi.fn(),
      suggestions: [
        {
          brand: 'Apple',
          deviceType: 'Smartphone',
          id: '11111111-1111-4111-8111-111111111111',
          imageUrl: null,
          model: 'iPhone 15',
          productId: null,
          slug: 'apple-iphone-15',
        },
      ],
    });
    const createField = (): ControllerRenderProps<
      z.input<typeof repairBookingSchema>,
      'deviceModel'
    > => ({
      name: 'deviceModel',
      value: 'iPhone 15',
      onBlur: vi.fn(),
      onChange: vi.fn(),
      ref: vi.fn(),
    });

    render(
      <>
        <RepairDeviceModelField
          catalogEnabled
          field={createField()}
          merchantSlug="ogabassey"
          onDeviceChange={vi.fn()}
          onSelectDevice={vi.fn()}
        />
        <RepairDeviceModelField
          catalogEnabled
          field={createField()}
          merchantSlug="ogabassey"
          onDeviceChange={vi.fn()}
          onSelectDevice={vi.fn()}
        />
      </>
    );

    const [firstInput, secondInput] = screen.getAllByRole('combobox');
    const [firstListbox, secondListbox] = screen.getAllByRole('listbox');
    if (!firstInput || !secondInput || !firstListbox || !secondListbox)
      throw new Error('both repair device pickers should render their listbox');
    expect(firstListbox.id).not.toBe(secondListbox.id);
    expect(firstInput).toHaveAttribute('aria-controls', firstListbox.id);
    expect(secondInput).toHaveAttribute('aria-controls', secondListbox.id);

    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn(),
    });
    fireEvent.keyDown(firstInput, { key: 'ArrowDown' });
    fireEvent.keyDown(secondInput, { key: 'ArrowDown' });

    const activeDescendants = [firstInput, secondInput].map((input) =>
      input.getAttribute('aria-activedescendant')
    );
    expect(activeDescendants[0]).toBe(
      firstListbox.querySelector('[role="option"]')?.id
    );
    expect(activeDescendants[1]).toBe(
      secondListbox.querySelector('[role="option"]')?.id
    );
    expect(activeDescendants[0]).not.toBe(activeDescendants[1]);
  });

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

  it('does not select stale suggestions while replacement results are loading', () => {
    const staleSuggestion = {
      brand: 'Apple',
      deviceType: 'Smartphone' as const,
      id: '11111111-1111-4111-8111-111111111111',
      imageUrl: null,
      model: 'iPhone 14',
      productId: null,
      slug: 'apple-iphone-14',
    };
    mockedSuggestionsHook.mockReturnValue({
      clearSuggestions: vi.fn(),
      hasSearched: true,
      isLoading: true,
      lookupFailed: false,
      refreshSuggestions: vi.fn(),
      suggestions: [staleSuggestion],
    });
    const onSelectDevice = vi.fn();
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
        onSelectDevice={onSelectDevice}
      />
    );

    const input = screen.getByRole('combobox');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(screen.getByRole('status')).toHaveTextContent('Searching');
    expect(input).not.toHaveAttribute('aria-activedescendant');
    expect(onSelectDevice).not.toHaveBeenCalled();
  });
});
