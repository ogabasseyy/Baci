import '@testing-library/jest-dom/vitest';
import type { MobileStoreReadiness } from '@baci/shared';
import { fireEvent, render, screen } from '@testing-library/react';
import type React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StoreSetupStatusCard } from './StoreSetupStatusCard';

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
}));

vi.mock('expo-router', () => ({
  router: { push: mocks.push },
}));

vi.mock('react-native', async () => {
  const ReactModule = await import('react');

  return {
    StyleSheet: {
      create: <T extends Record<string, unknown>>(styles: T) => styles,
    },
    View: ({ children }: { children?: React.ReactNode }) =>
      ReactModule.createElement('div', null, children),
  };
});

vi.mock('./ProgressCard', () => ({
  ProgressCard: ({
    onPress,
    progress,
    subtitle,
    title,
  }: {
    onPress?: () => void;
    progress: number;
    subtitle?: string;
    title: string;
  }) => (
    <button data-progress={progress} onClick={onPress} type="button">
      {title}
      {subtitle ? <span>{subtitle}</span> : null}
    </button>
  ),
}));

function buildReadiness(
  overrides: Partial<MobileStoreReadiness> = {}
): MobileStoreReadiness {
  return {
    completedRecommended: 5,
    completedRequired: 7,
    isPublished: true,
    isReady: true,
    items: [],
    merchantId: 'merchant-1',
    overallProgress: 100,
    storeBuild: {
      aiStatus: 'not_started',
      canApplyAiDraft: false,
      latestJobId: null,
      message: '',
      starterStoreReady: false,
    },
    surface: 'mobile',
    totalRecommended: 5,
    totalRequired: 7,
    ...overrides,
  };
}

describe('StoreSetupStatusCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows required setup progress until the store is ready', () => {
    render(
      <StoreSetupStatusCard
        isLive={false}
        isLoading={false}
        readiness={buildReadiness({ isReady: false, overallProgress: 71 })}
      />
    );

    expect(
      screen.getByRole('button', { name: /Finish Setup/ })
    ).toHaveAttribute('data-progress', '71');
    screen.getByText('Complete your store setup to start selling');
  });

  it('keeps setup available before publishing when required setup is complete', () => {
    render(
      <StoreSetupStatusCard
        isLive={false}
        isLoading={false}
        readiness={buildReadiness()}
      />
    );

    fireEvent.click(
      screen.getByRole('button', { name: /Finish setting up your store/ })
    );

    screen.getByText(
      'Your store is ready to launch. Finish the extras or publish now.'
    );
    expect(mocks.push).toHaveBeenCalledWith('/(admin)/setup-checklist');
  });

  it('keeps setup available after publishing while optional steps remain', () => {
    render(
      <StoreSetupStatusCard
        isLive
        isLoading={false}
        readiness={buildReadiness({ overallProgress: 82 })}
      />
    );

    fireEvent.click(
      screen.getByRole('button', { name: /Finish setting up your store/ })
    );

    screen.getByText(
      'Complete the remaining optional steps to get the most from your store.'
    );
    expect(mocks.push).toHaveBeenCalledWith('/(admin)/setup-checklist');
  });

  it('hides while readiness is loading', () => {
    render(
      <StoreSetupStatusCard
        isLive={false}
        isLoading
        readiness={buildReadiness({ isReady: false, overallProgress: 71 })}
      />
    );

    expect(screen.queryByRole('button')).toBeNull();
  });

  it('hides when readiness is unavailable', () => {
    render(
      <StoreSetupStatusCard isLive={false} isLoading={false} readiness={null} />
    );

    expect(screen.queryByRole('button')).toBeNull();
  });

  it('hides only after the published store reaches complete setup', () => {
    render(
      <StoreSetupStatusCard
        isLive
        isLoading={false}
        readiness={buildReadiness()}
      />
    );

    expect(screen.queryByRole('button')).toBeNull();
  });
});
