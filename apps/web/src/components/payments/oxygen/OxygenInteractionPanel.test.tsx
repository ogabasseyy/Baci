import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

describe('OxygenInteractionPanel states', () => {
  it('renders nothing while idle', () => {
    const { container } = renderPanel({ state: 'idle' });
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it.each(NON_IDLE_STATES)('exposes a status region while %s', (state) => {
    renderPanel({ state });
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('shows the checking copy with a spinner and no actions', () => {
    renderPanel({ state: 'checking' });
    const region = screen.getByRole('status');
    expect(region).toHaveTextContent('Checking Oxygen availability…');
    expect(
      within(region).getByTestId('oxygen-interaction-spinner')
    ).toBeInTheDocument();
    expect(within(region).queryByRole('button')).not.toBeInTheDocument();
  });

  it('shows the resume copy with a spinner and no actions', () => {
    renderPanel({ state: 'resuming' });
    const region = screen.getByRole('status');
    expect(region).toHaveTextContent(
      'Continue where you left off with Oxygen…'
    );
    expect(
      within(region).getByTestId('oxygen-interaction-spinner')
    ).toBeInTheDocument();
    expect(within(region).queryByRole('button')).not.toBeInTheDocument();
  });

  it('shows the do-not-close copy while initiating with no actions', () => {
    renderPanel({ state: 'initiating' });
    const region = screen.getByRole('status');
    expect(region).toHaveTextContent(
      'Starting Oxygen… Do not close this window.'
    );
    expect(
      within(region).getByTestId('oxygen-interaction-spinner')
    ).toBeInTheDocument();
    expect(within(region).queryByRole('button')).not.toBeInTheDocument();
  });

  it('shows no spinner once a state settles', () => {
    for (const state of [
      'ready',
      'unavailable',
      'signin-required',
      'handed-off',
      'failed',
    ] as OxygenInteractionState[]) {
      const { unmount } = renderPanel({ state });
      expect(
        screen.queryByTestId('oxygen-interaction-spinner')
      ).not.toBeInTheDocument();
      unmount();
    }
  });
});

describe('OxygenInteractionPanel actions', () => {
  it('offers submit + dismiss while ready', async () => {
    const user = userEvent.setup();
    const { onAction } = renderPanel({ state: 'ready' });
    const region = screen.getByRole('status');
    expect(region).toHaveTextContent('Oxygen is available for this order.');
    const submit = within(region).getByRole('button', {
      name: 'Continue with Oxygen',
    });
    const dismiss = within(region).getByRole('button', { name: 'Dismiss' });
    expect(submit).toHaveAttribute('type', 'button');
    expect(submit).not.toBeDisabled();
    expect(dismiss).not.toBeDisabled();
    await user.click(submit);
    expect(onAction).toHaveBeenCalledWith('submit');
    await user.click(dismiss);
    expect(onAction).toHaveBeenCalledWith('dismiss');
  });

  it.each(
    S04_MESSAGES
  )('renders $reason verbatim with recheck + dismiss', async ({
    reason,
    message,
  }) => {
    const user = userEvent.setup();
    const { onAction, unmount } = renderPanel({
      state: 'unavailable',
      reason,
    });
    const region = screen.getByRole('status');
    expect(within(region).getByText(message)).toBeInTheDocument();
    await user.click(
      within(region).getByRole('button', { name: 'Check again' })
    );
    expect(onAction).toHaveBeenCalledWith('recheck');
    await user.click(within(region).getByRole('button', { name: 'Dismiss' }));
    expect(onAction).toHaveBeenCalledWith('dismiss');
    unmount();
  });

  it('offers signin + dismiss while signin-required', async () => {
    const user = userEvent.setup();
    const { onAction } = renderPanel({
      state: 'signin-required',
      reason: 'oxygen_guest_not_allowed',
    });
    const region = screen.getByRole('status');
    expect(
      within(region).getByText('Sign in to continue with Oxygen.')
    ).toBeInTheDocument();
    await user.click(within(region).getByRole('button', { name: 'Sign in' }));
    expect(onAction).toHaveBeenCalledWith('signin');
    await user.click(within(region).getByRole('button', { name: 'Dismiss' }));
    expect(onAction).toHaveBeenCalledWith('dismiss');
  });

  it('falls back to the guest message for reason-less signin-required', () => {
    renderPanel({ state: 'signin-required' });
    expect(
      screen.getByText('Sign in to continue with Oxygen.')
    ).toBeInTheDocument();
  });

  it('offers dismiss only once handed-off', async () => {
    const user = userEvent.setup();
    const { onAction } = renderPanel({ state: 'handed-off' });
    const region = screen.getByRole('status');
    expect(region).toHaveTextContent(
      'Continue with Oxygen in the secure form.'
    );
    const buttons = within(region).getAllByRole('button');
    expect(buttons).toHaveLength(1);
    await user.click(buttons[0] as HTMLElement);
    expect(onAction).toHaveBeenCalledWith('dismiss');
  });

  it.each([
    { recoveries: [], labels: ['Dismiss'] },
    { recoveries: ['recheck'], labels: ['Check again', 'Dismiss'] },
    { recoveries: ['resubmit'], labels: ['Continue with Oxygen', 'Dismiss'] },
    {
      recoveries: ['recheck', 'resubmit'],
      labels: ['Check again', 'Continue with Oxygen', 'Dismiss'],
    },
  ] as Array<{
    recoveries: OxygenFailedRecovery[];
    labels: string[];
  }>)('offers $labels while failed', async ({ recoveries, labels }) => {
    const user = userEvent.setup();
    const { onAction, unmount } = renderPanel({
      state: 'failed',
      recoveries,
    });
    const region = screen.getByRole('status');
    expect(region).toHaveTextContent('Something went wrong.');
    const buttons = within(region).getAllByRole('button');
    expect(buttons.map((button) => button.textContent)).toEqual(labels);
    for (const button of buttons) {
      await user.click(button);
    }
    expect(onAction).toHaveBeenCalledTimes(labels.length);
    unmount();
  });
});

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
