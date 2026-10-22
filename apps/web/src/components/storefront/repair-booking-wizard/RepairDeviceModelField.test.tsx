import { fireEvent, render, screen } from '@testing-library/react';
import type { ControllerRenderProps } from 'react-hook-form';
import { describe, expect, it, vi } from 'vitest';
import type { z } from 'zod';
import type { repairBookingSchema } from '@/lib/validations/repair';
import { RepairDeviceModelField } from './RepairDeviceModelField';

describe('RepairDeviceModelField', () => {
  it('exposes a labeled device model combobox when catalog suggestions are enabled', () => {
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
});
