import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { FollowUpAlertSetting } from './follow-up-alert-setting';

vi.mock('@/components/ui/label', () => ({
  Label: ({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) => (
    <label htmlFor={htmlFor}>{children}</label>
  ),
}));

vi.mock('@/components/ui/switch', () => ({
  Switch: ({
    checked,
    id,
    onCheckedChange,
    ...props
  }: {
    checked: boolean;
    id?: string;
    onCheckedChange: (checked: boolean) => void;
    'aria-label'?: string;
  }) => (
    <button
      {...props}
      type="button"
      role="switch"
      id={id}
      aria-checked={checked}
      onClick={() => onCheckedChange(!checked)}
    />
  ),
}));

describe('FollowUpAlertSetting', () => {
  it('exposes a labelled switch and forwards the new value', async () => {
    const user = userEvent.setup();
    const onCheckedChange = vi.fn();

    render(<FollowUpAlertSetting enabled onCheckedChange={onCheckedChange} />);

    const toggle = screen.getByRole('switch', { name: 'Follow-up alerts' });
    expect(toggle).toHaveAttribute('aria-checked', 'true');

    await user.click(toggle);

    expect(onCheckedChange).toHaveBeenCalledWith(false);
  });
});
