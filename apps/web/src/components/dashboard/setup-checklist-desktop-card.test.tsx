import type { WebStoreReadiness } from '@baci/shared';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SetupChecklistDesktopCard } from './setup-checklist-desktop-card';

const readiness = {
  merchantId: '11111111-1111-4111-8111-111111111111',
  surface: 'web',
  isReady: true,
  isPublished: false,
  completedRequired: 1,
  totalRequired: 1,
  completedRecommended: 0,
  totalRecommended: 0,
  overallProgress: 100,
  storeBuild: {
    starterStoreReady: true,
    aiStatus: 'ready',
    latestJobId: null,
    canApplyAiDraft: false,
    message: 'Ready.',
  },
  items: [],
} satisfies WebStoreReadiness;

describe('SetupChecklistDesktopCard', () => {
  it('offers publish and dismiss actions when the store is ready', () => {
    const onDismiss = vi.fn();
    const onPublish = vi.fn();

    render(
      <SetupChecklistDesktopCard
        compact={false}
        dismissible
        displayItems={[]}
        incompleteItems={[]}
        onDismiss={onDismiss}
        onPublish={onPublish}
        publishing={false}
        readiness={readiness}
        requiredIncomplete={[]}
        setShowAll={vi.fn()}
        showAll={false}
      />
    );

    fireEvent.click(
      screen.getByRole('button', {
        name: /Ready to Launch.*100% complete.*Setup complete/,
      })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Publish Store' }));
    fireEvent.click(
      screen.getByRole('button', { name: 'Dismiss setup checklist' })
    );
    expect(onPublish).toHaveBeenCalledOnce();
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('keeps the setup checklist collapsed by default', () => {
    render(
      <SetupChecklistDesktopCard
        compact={false}
        dismissible
        displayItems={[]}
        incompleteItems={[]}
        onDismiss={vi.fn()}
        onPublish={vi.fn()}
        publishing={false}
        readiness={{ ...readiness, isPublished: true, overallProgress: 64 }}
        requiredIncomplete={[]}
        setShowAll={vi.fn()}
        showAll={false}
      />
    );

    const trigger = screen.getByRole('button', {
      name: /Store is Live.*64% complete.*Required setup complete/,
    });

    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(trigger);

    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Setup Progress')).toBeInTheDocument();
  });

  it('hides publish and dismiss actions when they are unavailable', () => {
    render(
      <SetupChecklistDesktopCard
        compact={false}
        dismissible={false}
        displayItems={[]}
        incompleteItems={[]}
        onDismiss={vi.fn()}
        onPublish={vi.fn()}
        publishing={false}
        readiness={{ ...readiness, isReady: false, overallProgress: 0 }}
        requiredIncomplete={[]}
        setShowAll={vi.fn()}
        showAll={false}
      />
    );

    expect(
      screen.queryByRole('button', { name: 'Publish Store' })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Dismiss setup checklist' })
    ).not.toBeInTheDocument();
  });
});
