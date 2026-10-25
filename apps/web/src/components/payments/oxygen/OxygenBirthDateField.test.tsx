import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { OxygenBirthDateField } from './OxygenBirthDateField';

it('opens from the field and offers direct year selection with themed calendar controls', () => {
  render(
    <form aria-label="Identity">
      <OxygenBirthDateField defaultValue="1990-02-10" />
    </form>
  );
  const field = screen.getByLabelText('Date of birth');
  expect(field).toHaveValue('10/02/1990');
  fireEvent.click(field);
  expect(screen.getByRole('combobox', { name: 'Birth year' })).toHaveValue(
    '1990'
  );
  fireEvent.change(screen.getByRole('combobox', { name: 'Birth year' }), {
    target: { value: '1985' },
  });
  expect(screen.getByRole('combobox', { name: 'Birth year' })).toHaveValue(
    '1985'
  );
  fireEvent.click(
    screen.getByRole('gridcell', { name: /Choose Friday, February 15th, 1985/ })
  );
  expect(field).toHaveValue('15/02/1985');
  expect(
    new FormData(screen.getByRole('form') as HTMLFormElement).get(
      'date_of_birth'
    )
  ).toBe('1985-02-15');
  fireEvent.click(field);
  fireEvent.keyDown(field, { key: 'Escape' });
  expect(screen.queryByRole('combobox', { name: 'Birth year' })).toBeNull();
  expect(
    new FormData(screen.getByRole('form') as HTMLFormElement).get(
      'date_of_birth'
    )
  ).toBe('1985-02-15');
});

it('accepts manual dates, rejects impossible dates and never submits a stale saved date', () => {
  render(
    <form aria-label="Identity">
      <OxygenBirthDateField defaultValue="1990-02-10" />
    </form>
  );
  const form = screen.getByRole('form') as HTMLFormElement;
  const field = screen.getByLabelText('Date of birth') as HTMLInputElement;
  fireEvent.change(field, { target: { value: '31/02/1990' } });
  expect(field.checkValidity()).toBe(false);
  expect(new FormData(form).get('date_of_birth')).toBe('');
  fireEvent.change(field, { target: { value: '29/02/1992' } });
  expect(field.checkValidity()).toBe(true);
  expect(new FormData(form).get('date_of_birth')).toBe('1992-02-29');
  fireEvent.change(field, { target: { value: '01/01/2999' } });
  expect(field.checkValidity()).toBe(false);
  expect(new FormData(form).get('date_of_birth')).toBe('');
});
