import { render, screen } from '@testing-library/react';
import type React from 'react';
import { describe, expect, it, vi } from 'vitest';

const select = vi.hoisted(() => ({ onValueChange: (_value: string) => {} }));

vi.mock('@/components/ui/select', () => ({
  Select: ({
    children,
    onValueChange,
  }: {
    children: React.ReactNode;
    onValueChange: (value: string) => void;
  }) => {
    select.onValueChange = onValueChange;
    return <div>{children}</div>;
  },
  SelectContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  SelectItem: ({
    children,
    value,
  }: {
    children: React.ReactNode;
    value: string;
  }) => (
    <button type="button" onClick={() => select.onValueChange(value)}>
      {children}
    </button>
  ),
  SelectTrigger: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  SelectValue: () => null,
}));

import { CreateNotificationSelect } from './create-notification-select';

describe('CreateNotificationSelect', () => {
  it('uses its label for an accessible trigger and reports the selected value', async () => {
    const onValueChange = vi.fn();
    render(
      <CreateNotificationSelect
        id="priority"
        label="Priority"
        onValueChange={onValueChange}
        options={[
          ['normal', 'Normal'],
          ['urgent', 'Urgent'],
        ]}
        value="normal"
      />
    );

    expect(
      screen.getByRole('button', { name: 'Priority' })
    ).toBeInTheDocument();
    screen.getByRole('button', { name: 'Urgent' }).click();

    expect(onValueChange).toHaveBeenCalledWith('urgent');
  });
});
