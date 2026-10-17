import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { UtilityTabs } from './UtilityTabs';

vi.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

describe('UtilityTabs', () => {
  it('exposes selected tab semantics and emits a new selection', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();

    render(
      <UtilityTabs
        activeTab="airtime"
        onSelect={onSelect}
      />
    );

    expect(screen.getByRole('tablist', { name: 'Utility type' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Airtime' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    expect(screen.getByRole('tab', { name: 'Data' })).toHaveAttribute(
      'aria-selected',
      'false'
    );

    await user.click(screen.getByRole('tab', { name: 'Data' }));

    expect(onSelect).toHaveBeenCalledWith('data');
  });

  it('moves selection and focus with arrow keys', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();

    render(
      <UtilityTabs
        activeTab="airtime"
        onSelect={onSelect}
      />
    );

    screen.getByRole('tab', { name: 'Airtime' }).focus();
    await user.keyboard('{ArrowRight}');

    expect(onSelect).toHaveBeenCalledWith('data');
    expect(screen.getByRole('tab', { name: 'Data' })).toHaveFocus();
  });

  it('blocks click and keyboard switches while disabled', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();

    render(
      <UtilityTabs
        activeTab="airtime"
        disabled={true}
        onSelect={onSelect}
      />
    );

    // A mid-flight tab switch would settle the result + history poll
    // under the wrong utility type — nothing may fire.
    for (const name of ['Airtime', 'Data', 'TV', 'Power', 'Betting']) {
      expect(screen.getByRole('tab', { name })).toBeDisabled();
    }
    await user.click(screen.getByRole('tab', { name: 'Data' }));
    screen.getByRole('tab', { name: 'Airtime' }).focus();
    await user.keyboard('{ArrowRight}');

    expect(onSelect).not.toHaveBeenCalled();
  });
});
