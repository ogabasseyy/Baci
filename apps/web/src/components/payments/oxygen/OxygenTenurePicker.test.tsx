import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { expect, it } from 'vitest';
import { OxygenTenurePicker } from './OxygenTenurePicker';

it('shows available months as compact choices and changes the selected period', () => {
  function Picker() {
    const [value, setValue] = useState(3);
    return (
      <OxygenTenurePicker months={[3, 6]} value={value} onChange={setValue} />
    );
  }
  render(<Picker />);
  expect(screen.queryByRole('combobox')).toBeNull();
  expect(screen.getByRole('radio', { name: '3 months' })).toBeChecked();
  fireEvent.click(screen.getByRole('radio', { name: '6 months' }));
  expect(screen.getByRole('radio', { name: '6 months' })).toBeChecked();
  expect(screen.queryByRole('radio', { name: '12 months' })).toBeNull();
});
