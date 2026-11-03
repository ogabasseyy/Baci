import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ImeiCheckerDeviceTabs } from './imei-checker-device-tabs';

describe('ImeiCheckerDeviceTabs', () => {
  it('renders all four device category tabs', () => {
    render(<ImeiCheckerDeviceTabs onSelect={vi.fn()} selected="smartphone" />);

    expect(screen.getByRole('tab', { name: 'Phone checks' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'iPad checks' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Mac checks' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Watch checks' })).toBeTruthy();
  });

  it('marks only the selected tab as aria-selected', () => {
    render(<ImeiCheckerDeviceTabs onSelect={vi.fn()} selected="laptop" />);

    expect(
      screen
        .getByRole('tab', { name: 'Mac checks' })
        .getAttribute('aria-selected')
    ).toBe('true');
    expect(
      screen
        .getByRole('tab', { name: 'Phone checks' })
        .getAttribute('aria-selected')
    ).toBe('false');
  });

  it('calls onSelect with the tapped device id', () => {
    const onSelect = vi.fn();
    render(<ImeiCheckerDeviceTabs onSelect={onSelect} selected="smartphone" />);

    fireEvent.click(screen.getByRole('tab', { name: 'Watch checks' }));

    expect(onSelect).toHaveBeenCalledWith('watch');
  });
});

it('links each tab to the device content panel', () => {
  render(
    <ImeiCheckerDeviceTabs
      selected="smartphone"
      onSelect={vi.fn()}
      panelId="device-panel"
    />
  );
  const tab = screen.getByRole('tab', { name: 'Phone checks' });
  expect(tab.getAttribute('aria-controls')).toBe('device-panel');
  expect(tab.id).toBe('device-panel-smartphone-tab');
});
