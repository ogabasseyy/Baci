import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native', async () => {
  const React = await import('react');
  return {
    Switch: ({
      accessibilityLabel,
      onValueChange,
      value,
    }: {
      accessibilityLabel?: string;
      onValueChange?: (value: boolean) => void;
      value?: boolean;
    }) =>
      React.createElement('button', {
        'aria-checked': value ?? false,
        'aria-label': accessibilityLabel,
        onClick: () => onValueChange?.(!(value ?? false)),
        role: 'switch',
        type: 'button',
      }),
    Text: ({ children }: { children?: ReactNode }) =>
      React.createElement('span', null, children),
    View: ({ children }: { children?: ReactNode }) =>
      React.createElement('div', null, children),
  };
});

vi.mock('./notifications.styles', () => ({
  styles: new Proxy(
    {},
    {
      get: () => ({}),
    }
  ),
}));

import { FollowUpAlertsSetting } from './FollowUpAlertsSetting';

const colors = {
  border: '#eee',
  card: '#fff',
  primary: '#25f',
  text: '#012',
  textMuted: '#678',
  textSecondary: '#345',
} as never;

describe('FollowUpAlertsSetting', () => {
  it('labels the switch for screen readers and reports changes', () => {
    const onValueChange = vi.fn();

    render(
      <FollowUpAlertsSetting
        colors={colors}
        enabled
        onValueChange={onValueChange}
      />
    );

    const toggle = screen.getByRole('switch', { name: 'Follow-up alerts' });
    expect(toggle).toBeChecked();

    fireEvent.click(toggle);

    expect(onValueChange).toHaveBeenCalledWith(false);
  });
});
