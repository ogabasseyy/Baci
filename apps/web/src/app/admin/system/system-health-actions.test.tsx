import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SystemHealthActions } from './system-health-actions';

describe('SystemHealthActions', () => {
  it('runs each maintenance action when it is available', () => {
    const onRefresh = vi.fn();
    const onReloadAnalytics = vi.fn();
    render(
      <SystemHealthActions
        loading={false}
        reloadingAnalytics={false}
        onRefresh={onRefresh}
        onReloadAnalytics={onReloadAnalytics}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /reload analytics/i }));
    fireEvent.click(screen.getByRole('button', { name: /run health check/i }));

    expect(onReloadAnalytics).toHaveBeenCalledTimes(1);
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('disables only the action that is currently running', () => {
    render(
      <SystemHealthActions
        loading
        reloadingAnalytics={false}
        onRefresh={vi.fn()}
        onReloadAnalytics={vi.fn()}
      />
    );
    expect(
      screen.getByRole('button', { name: /run health check/i })
    ).toBeDisabled();
    expect(
      screen.getByRole('button', { name: /reload analytics/i })
    ).toBeEnabled();
  });
});
