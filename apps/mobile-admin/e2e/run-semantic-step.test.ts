import { describe, expect, it, vi } from 'vitest';
import { runSemanticStep } from './run-semantic-step';

describe('runSemanticStep', () => {
  it('asserts readiness before and after the action', async () => {
    const events: string[] = [];

    const result = await runSemanticStep({
      name: 'submit login',
      before: () => {
        events.push('before');
      },
      action: () => {
        events.push('action');
        return 'dashboard';
      },
      after: (screen) => {
        events.push(`after:${screen}`);
      },
    });

    expect(result).toBe('dashboard');
    expect(events).toEqual(['before', 'action', 'after:dashboard']);
  });

  it('does not run the action when the before assertion fails', async () => {
    const action = vi.fn();

    await expect(
      runSemanticStep({
        name: 'open settings',
        before: () => {
          throw new Error('settings button is missing');
        },
        action,
        after: () => undefined,
      })
    ).rejects.toThrow(
      'Semantic step "open settings" before assertion failed: settings button is missing'
    );
    expect(action).not.toHaveBeenCalled();
  });

  it('reports action and after assertion failures with the step name', async () => {
    await expect(
      runSemanticStep({
        name: 'submit login',
        before: () => undefined,
        action: () => {
          throw new Error('tap failed');
        },
        after: () => undefined,
      })
    ).rejects.toThrow('Semantic step "submit login" action failed: tap failed');

    await expect(
      runSemanticStep({
        name: 'submit login',
        before: () => undefined,
        action: () => 'login',
        after: () => {
          throw new Error('dashboard did not render');
        },
      })
    ).rejects.toThrow(
      'Semantic step "submit login" after assertion failed: dashboard did not render'
    );
  });
});
