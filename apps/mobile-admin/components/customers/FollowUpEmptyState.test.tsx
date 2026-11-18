import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FollowUpEmptyState } from './FollowUpEmptyState';

vi.mock('@react-native-vector-icons/ionicons', async () => {
  const React = await import('react');
  return {
    default: () => React.createElement('div', null),
  };
});

vi.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({
    colors: {
      error: '#ff3b30',
      primary: '#0a84ff',
      primaryLight: '#e6f2ff',
      success: '#34c759',
      text: '#ffffff',
      textSecondary: '#aeaeb2',
    },
  }),
}));

describe('FollowUpEmptyState', () => {
  it('reports success when there are genuinely no follow-ups', () => {
    render(
      <FollowUpEmptyState
        viewState={{ status: 'empty' }}
        isRetrying={false}
        onRetry={vi.fn()}
      />
    );

    expect(screen.getByText('No issues')).toBeTruthy();
    expect(
      screen.getByText('No follow-ups need attention right now.')
    ).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('reports a load failure instead of success when the query errored', () => {
    render(
      <FollowUpEmptyState
        viewState={{
          status: 'error',
          title: "Couldn't load follow-ups",
          message:
            "We couldn't check for unsuccessful transactions. This does not mean there are none.",
        }}
        isRetrying={false}
        onRetry={vi.fn()}
      />
    );

    expect(screen.getByText("Couldn't load follow-ups")).toBeTruthy();
    expect(screen.getByText(/does not mean\s+there are none/)).toBeTruthy();
    expect(
      screen.queryByText('No follow-ups need attention right now.')
    ).toBeNull();
  });

  it('calls onRetry when the retry button is pressed', () => {
    const onRetry = vi.fn();
    render(
      <FollowUpEmptyState
        viewState={{
          status: 'error',
          title: "Couldn't load follow-ups",
          message: 'Retry the request.',
        }}
        isRetrying={false}
        onRetry={onRetry}
      />
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'Retry loading follow-ups' })
    );

    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('disables retry and shows progress while a retry is in flight', () => {
    const onRetry = vi.fn();
    render(
      <FollowUpEmptyState
        viewState={{
          status: 'error',
          title: "Couldn't load follow-ups",
          message: 'Retry the request.',
        }}
        isRetrying={true}
        onRetry={onRetry}
      />
    );

    const retry = screen.getByRole('button', {
      name: 'Retry loading follow-ups',
    });
    expect(retry).toBeDisabled();
    expect(screen.getByText('Retrying…')).toBeTruthy();

    fireEvent.click(retry);
    expect(onRetry).not.toHaveBeenCalled();
  });

  it('does not report success while follow-ups are still loading', () => {
    render(
      <FollowUpEmptyState
        viewState={{ status: 'loading' }}
        isRetrying={false}
        onRetry={vi.fn()}
      />
    );

    expect(screen.getByText('Loading follow-ups…')).toBeTruthy();
    expect(screen.queryByText('No issues')).toBeNull();
  });
});
