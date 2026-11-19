import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type {
  OxygenFailedRecovery,
  OxygenInteractionReason,
  OxygenInteractionState,
} from '@/lib/payments/oxygen/interaction';
import {
  OxygenInteractionPanel,
  type OxygenInteractionPanelProps,
} from './OxygenInteractionPanel';

const S04_MESSAGES: Array<{
  reason: OxygenInteractionReason;
  message: string;
}> = [
  {
    reason: 'oxygen_identity_mismatch',
    message: 'This order cannot use Oxygen.',
  },
  {
    reason: 'oxygen_environment_mismatch',
    message: 'Oxygen is not available here.',
  },
  {
    reason: 'oxygen_guest_not_allowed',
    message: 'Sign in to continue with Oxygen.',
  },
  {
    reason: 'oxygen_not_configured',
    message: 'Oxygen is not available for this store.',
  },
  {
    reason: 'oxygen_rollout_disabled',
    message: 'Oxygen is not available right now.',
  },
  {
    reason: 'oxygen_provider_unverified',
    message: 'Oxygen is not available for this store.',
  },
];

const NON_IDLE_STATES: OxygenInteractionState[] = [
  'checking',
  'ready',
  'unavailable',
  'signin-required',
  'initiating',
  'handed-off',
  'resuming',
  'failed',
];

const FORBIDDEN_PHRASES = [
  'approved',
  'approval',
  'eligible',
  'eligibility',
  'qualify',
  'qualified',
  'pre-approved',
  'approved for',
];

function renderPanel(
  props: Partial<OxygenInteractionPanelProps> & {
    state: OxygenInteractionState;
  }
) {
  const onAction = vi.fn();
  const rendered = render(
    <OxygenInteractionPanel
      reason={undefined}
      recoveries={[]}
      {...props}
      onAction={onAction}
    />
  );
  return { onAction, ...rendered };
}

describe('OxygenInteractionPanel theme and copy hygiene', () => {
  it('styles the card and primary action with store tokens', () => {
    renderPanel({ state: 'ready' });
    const region = screen.getByRole('status');
    expect(region.className).toContain('store-primary');
    const submit = within(region).getByRole('button', {
      name: 'Continue with Oxygen',
    });
    expect(submit.className).toContain('bg-store-primary');
  });

  it('renders no hardcoded hex colors in any state', () => {
    const hexColor = /#[0-9a-f]{3,8}\b/i;
    for (const state of NON_IDLE_STATES) {
      const { unmount } = renderPanel({
        state,
        reason: 'oxygen_rollout_disabled',
        recoveries: ['recheck', 'resubmit'],
      });
      expect(screen.getByRole('status').outerHTML).not.toMatch(hexColor);
      unmount();
    }
  });

  it('keeps every rendered copy free of credit-decision language', () => {
    const reasons: Array<OxygenInteractionReason | undefined> = [
      ...S04_MESSAGES.map((entry) => entry.reason),
      undefined,
    ];
    for (const state of NON_IDLE_STATES) {
      for (const reason of reasons) {
        for (const recoveries of [
          [],
          ['recheck', 'resubmit'],
        ] as OxygenFailedRecovery[][]) {
          const { unmount } = renderPanel({ state, reason, recoveries });
          const text =
            screen.getByRole('status').textContent?.toLowerCase() ?? '';
          for (const phrase of FORBIDDEN_PHRASES) {
            expect(text).not.toContain(phrase);
          }
          unmount();
        }
      }
    }
  });
});

describe('OxygenInteractionPanel module shape (static)', () => {
  const source = readFileSync(
    resolve(
      process.cwd(),
      'src/components/payments/oxygen/OxygenInteractionPanel.tsx'
    ),
    'utf8'
  );

  it('is a client module', () => {
    expect(source).toContain("'use client'");
  });

  it('never fetches and never touches routing, storage, or globals', () => {
    expect(source).not.toContain('global.fetch');
    expect(source).not.toMatch(/(^|[^A-Za-z])fetch\(/m);
    expect(source).not.toContain('XMLHttpRequest');
    expect(source).not.toContain('next/router');
    expect(source).not.toContain('next/navigation');
    expect(source).not.toContain('sessionStorage');
    expect(source).not.toContain('localStorage');
    expect(source).not.toContain('window.');
    expect(source).not.toContain('document.');
    expect(source).not.toContain('transport');
    expect(source).not.toContain('token-cache');
    expect(source).not.toContain('posthog');
    expect(source).not.toContain('captureClientEvent');
    expect(source).not.toContain('console');
  });

  it('keeps approval language out of the module', () => {
    for (const phrase of FORBIDDEN_PHRASES) {
      expect(source.toLowerCase()).not.toContain(phrase);
    }
  });

  it('mentions no provider, loan, attempt, or chat-transcript surface', () => {
    expect(source).not.toMatch(/provider/i);
    expect(source).not.toMatch(/loan/i);
    expect(source).not.toContain('attemptId');
    expect(source).not.toContain('transcript');
  });
});
