import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ImeiBlacklistCheckAction } from './imei-blacklist-check-action';

const mocks = vi.hoisted(() => ({ availability: vi.fn() }));
vi.mock('./use-imei-runtime-availability', () => ({
  useImeiRuntimeAvailability: mocks.availability,
}));

describe('ImeiBlacklistCheckAction', () => {
  beforeEach(() => {
    mocks.availability.mockReset().mockReturnValue({
      availableTierKeys: ['blacklist'],
      loading: false,
      failed: false,
    });
  });

  it('checks phone availability and labels the exact wallet charge', () => {
    const onCheck = vi.fn();
    render(<ImeiBlacklistCheckAction isChecking={false} onCheck={onCheck} />);
    expect(mocks.availability).toHaveBeenCalledWith('smartphone');
    fireEvent.click(
      screen.getByRole('button', { name: 'Check blacklist status · ₦700' })
    );
    expect(onCheck).toHaveBeenCalledOnce();
  });

  it.each([
    { availableTierKeys: [], loading: false, failed: false },
    { availableTierKeys: null, loading: true, failed: false },
    { availableTierKeys: null, loading: false, failed: true },
  ])('does not sell a check without confirmed availability: %j', (availability) => {
    mocks.availability.mockReturnValue(availability);
    render(<ImeiBlacklistCheckAction isChecking={false} onCheck={vi.fn()} />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('disables the charge action while the check is in progress', () => {
    const onCheck = vi.fn();
    render(<ImeiBlacklistCheckAction isChecking onCheck={onCheck} />);
    const button = screen.getByRole('button', { name: 'Checking blacklist…' });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(onCheck).not.toHaveBeenCalled();
  });
});
