import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { OxygenLoadingButton } from './OxygenLoadingButton';

it('disables repeated actions and announces the pending label', () => {
  const click = vi.fn();
  const view = render(
    <OxygenLoadingButton onClick={click}>Continue</OxygenLoadingButton>
  );
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  view.rerender(
    <OxygenLoadingButton loading pendingLabel="Saving…" onClick={click}>
      Continue
    </OxygenLoadingButton>
  );
  const button = screen.getByRole('button', { name: 'Saving…' });
  expect(button).toBeDisabled();
  expect(button).toHaveAttribute('aria-busy', 'true');
  fireEvent.click(button);
  expect(click).toHaveBeenCalledOnce();
});
