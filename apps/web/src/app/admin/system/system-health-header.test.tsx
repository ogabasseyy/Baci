import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SystemHealthHeader } from './system-health-header';

describe('SystemHealthHeader', () => {
  it('shows system context and dispatches independent header actions', () => {
    const onRefresh = vi.fn();
    const onReloadAnalytics = vi.fn();
    render(
      <SystemHealthHeader
        loading={false}
        reloadingAnalytics={false}
        onRefresh={onRefresh}
        onReloadAnalytics={onReloadAnalytics}
      />
    );

    expect(
      screen.getByRole('heading', { name: 'System Health' })
    ).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh Status' }));
    fireEvent.click(screen.getByRole('button', { name: /reload analytics/i }));

    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(onReloadAnalytics).toHaveBeenCalledTimes(1);
  });

  it('disables refresh while checking health and reload while analytics is reloading', () => {
    const { rerender } = render(
      <SystemHealthHeader
        loading
        reloadingAnalytics={false}
        onRefresh={vi.fn()}
        onReloadAnalytics={vi.fn()}
      />
    );
    expect(
      screen.getByRole('button', { name: 'Refresh Status' })
    ).toBeDisabled();
    expect(
      screen.getByRole('button', { name: /reload analytics/i })
    ).toBeEnabled();

    rerender(
      <SystemHealthHeader
        loading={false}
        reloadingAnalytics
        onRefresh={vi.fn()}
        onReloadAnalytics={vi.fn()}
      />
    );
    expect(
      screen.getByRole('button', { name: 'Refresh Status' })
    ).toBeEnabled();
    expect(
      screen.getByRole('button', { name: /reload analytics/i })
    ).toBeDisabled();
  });
});
