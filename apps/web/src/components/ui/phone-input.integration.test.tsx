import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import type { Value } from 'react-phone-number-input';
import { describe, expect, it } from 'vitest';
import { PhoneInput } from './phone-input';

function PhoneField({ country = 'NG' }: { country?: 'NG' | 'US' | 'IT' }) {
  const [value, setValue] = useState<Value>();
  return (
    <>
      <PhoneInput
        aria-label="Phone number"
        defaultCountry={country}
        value={value}
        onChange={setValue}
      />
      <output aria-label="Saved number">{value}</output>
    </>
  );
}

describe('PhoneInput real input regression', () => {
  it('strips the trunk zero from the exact pasted number +234 08034096325', async () => {
    const user = userEvent.setup();
    render(<PhoneField />);
    await user.click(screen.getByRole('textbox', { name: 'Phone number' }));
    await user.keyboard('{Control>}a{/Control}');
    await user.paste('+234 08034096325');
    expect(screen.getByLabelText('Saved number')).toHaveTextContent(
      /^\+2348034096325$/
    );
    expect(screen.getByRole('textbox', { name: 'Phone number' })).toHaveValue(
      '+234 803 409 6325'
    );
  });
  it('limits a Nigerian number when typing excess digits', async () => {
    const user = userEvent.setup();
    render(<PhoneField />);
    await user.type(
      screen.getByRole('textbox', { name: 'Phone number' }),
      '080123456789999999999'
    );
    expect(screen.getByLabelText('Saved number')).toHaveTextContent(
      /^\+2348012345678$/
    );
    expect(screen.getByRole('textbox', { name: 'Phone number' })).toHaveValue(
      '+234 801 234 5678'
    );
  });

  it('preserves a valid zero when pasting an international Nigerian number', async () => {
    const user = userEvent.setup();
    render(<PhoneField />);
    await user.click(screen.getByRole('textbox', { name: 'Phone number' }));
    await user.keyboard('{Control>}a{/Control}');
    await user.paste('+2348012345678');
    expect(screen.getByLabelText('Saved number')).toHaveTextContent(
      /^\+2348012345678$/
    );
    expect(screen.getByRole('textbox', { name: 'Phone number' })).toHaveValue(
      '+234 801 234 5678'
    );
  });

  it('limits an overlong pasted Nigerian number', async () => {
    const user = userEvent.setup();
    render(<PhoneField />);
    await user.click(screen.getByRole('textbox', { name: 'Phone number' }));
    await user.keyboard('{Control>}a{/Control}');
    await user.paste('+2348012345678999999999');
    expect(screen.getByLabelText('Saved number')).toHaveTextContent(
      /^\+2348012345678$/
    );
    expect(screen.getByRole('textbox', { name: 'Phone number' })).toHaveValue(
      '+234 801 234 5678'
    );
  });

  it('uses the selected country length for US numbers', async () => {
    const user = userEvent.setup();
    render(<PhoneField country="US" />);
    await user.type(
      screen.getByRole('textbox', { name: 'Phone number' }),
      '21337342539999'
    );
    expect(screen.getByLabelText('Saved number')).toHaveTextContent(
      /^\+12133734253$/
    );
  });

  it('preserves the significant leading zero of an Italian number', async () => {
    const user = userEvent.setup();
    render(<PhoneField country="IT" />);
    await user.click(screen.getByRole('textbox', { name: 'Phone number' }));
    await user.keyboard('{Control>}a{/Control}');
    await user.paste('+39066982');
    expect(screen.getByLabelText('Saved number')).toHaveTextContent(
      /^\+39066982$/
    );
  });
});
