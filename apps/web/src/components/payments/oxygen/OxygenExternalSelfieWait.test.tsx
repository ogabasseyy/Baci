import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { OxygenExternalSelfieWait } from './OxygenExternalSelfieWait';

afterEach(cleanup);

it('explains how to return and checks status only when requested', () => {
  const onCheck = vi.fn();
  const onBack = vi.fn();
  render(<OxygenExternalSelfieWait onCheck={onCheck} onBack={onBack} />);

  expect(
    screen.getByRole('heading', { name: 'Complete your selfie with Oxygen' })
  ).toBeVisible();
  expect(screen.getByText(/return to this tab/i)).toBeVisible();
  expect(onCheck).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Check selfie status' }));
  expect(onCheck).toHaveBeenCalledTimes(1);
  expect(onBack).not.toHaveBeenCalled();
});

it('returns to camera options without checking status', () => {
  const onCheck = vi.fn();
  const onBack = vi.fn();
  render(<OxygenExternalSelfieWait onCheck={onCheck} onBack={onBack} />);

  fireEvent.click(
    screen.getByRole('button', { name: 'Return to camera options' })
  );
  expect(onBack).toHaveBeenCalledTimes(1);
  expect(onCheck).not.toHaveBeenCalled();
});
