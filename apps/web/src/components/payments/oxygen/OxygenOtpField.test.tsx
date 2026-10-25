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
it('removes displayed digits immediately during checking and keeps them hidden through success', () => {
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
  for (const digit of '123456') expect(screen.queryByText(digit)).toBeNull();
  view.rerender(<OxygenOtpField {...props} verified />);
  for (const digit of '123456') expect(screen.queryByText(digit)).toBeNull();
  expect(screen.getByText('Code verified.')).toBeVisible();
});
