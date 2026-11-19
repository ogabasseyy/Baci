import { render, screen } from '@testing-library/react';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { OxygenOtpField } from './OxygenOtpField';

beforeAll(() =>
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  )
);
afterAll(() => vi.unstubAllGlobals());
it('keeps digits visible while checking and hides them after confirmation', () => {
  const props = {
    value: '123456',
    onChange: vi.fn(),
    onComplete: vi.fn(),
    disabled: false,
    pending: false,
    verified: false,
  };
  const view = render(<OxygenOtpField {...props} />);
  expect(screen.getByText('1')).toBeVisible();
  view.rerender(<OxygenOtpField {...props} pending />);
  for (const digit of '123456') expect(screen.getByText(digit)).toBeVisible();
  expect(screen.getByRole('textbox')).toBeDisabled();
  view.rerender(<OxygenOtpField {...props} verified />);
  for (const digit of '123456') expect(screen.queryByText(digit)).toBeNull();
  expect(screen.getByText('Code verified.')).toBeVisible();
});
