import { createHash } from 'node:crypto';
import { piggyvestSavingsScreenSchema } from '@baci/shared/contracts';
import { createPiggyvestDraftClosureClientBinding } from '@baci/shared/lib';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { BoundDraftClosureReview } from '@/components/storefront/piggyvest-savings/draft-closure-binding';
import { draftClosureLocalFixture as fixture } from './customer-draft-closure-local.test-fixture';

vi.mock('server-only', () => ({}));
const enabled = process.env.PIGGYVEST_RUN_DRAFT_CLOSURE === '1';
const listeners: Array<{ close: () => Promise<void> }> = [];
afterEach(async () => {
  cleanup();
  await Promise.all(listeners.splice(0).map((listener) => listener.close()));
});

it.skipIf(!enabled)(
  'actual rendered closure recovers a lost HTTP response with one durable receipt and no financial effects',
  async () => {
    const server = await fixture.server(816);
    listeners.push(server);
    const goalId = fixture.goal(816);
    let cookie = 'synthetic-session=owner';
    let lost = false;
    let posts = 0;
    const localFetch: typeof globalThis.fetch = async (input, init) => {
      const target = new URL(String(input));
      if (target.origin !== server.origin)
        throw new Error('External HTTP prohibited');
      const headers = new Headers(init?.headers);
      headers.set('cookie', cookie);
      headers.set('origin', server.origin);
      const response = await fetch(target, { ...init, headers });
      if (init?.method === 'POST') {
        posts++;
        if (!lost) {
          lost = true;
          await response.body?.cancel();
          throw new Error('Synthetic response lost after actual commit');
        }
      }
      return response;
    };
    const csrf = await localFetch(`${server.origin}/csrf`, {
      redirect: 'error',
      signal: AbortSignal.timeout(5000),
    });
    expect(csrf.status).toBe(200);
    const token = (await csrf.json()).csrfToken;
    expect(csrf.headers.getSetCookie().length).toBeGreaterThan(0);
    cookie += `; ${csrf.headers
      .getSetCookie()
      .map((value) => value.split(';')[0])
      .join('; ')}`;
    const text = 'Synthetic terms only.';
    const source = piggyvestSavingsScreenSchema.parse({
      environment: 'staging',
      status: 'ready',
      sessionKey: 'synthetic-owner-session',
      goalId,
      policy: {
        status: 'draft',
        goalId,
        revisionId: goalId,
        device: { productName: 'Synthetic', variant: null, condition: 'New' },
        terms: {
          version: 'synthetic-v1',
          hash: createHash('sha256').update(text).digest('hex'),
          text,
        },
        consent: 'accepted',
      },
      eligibility: { status: 'unavailable' },
      funding: { status: 'unavailable' },
      progress: { status: 'unavailable' },
    });
    const options = {
      source,
      operationId: 'cccccccc-0000-4000-8000-000000000816',
      tenantKey: 'synthetic',
      isCurrent: () => true,
      http: {
        configuration: {
          mode: 'local_test',
          baseUrl: server.origin,
          endpointPath: '/close-plan',
          credentials: 'same-origin',
        },
        fetch: localFetch,
        getCsrfToken: async () => token,
      },
    };
    const binding = await createPiggyvestDraftClosureClientBinding(options);
    render(<BoundDraftClosureReview source={source} binding={binding} />);
    expect(screen.getByRole('button', { name: 'Close plan' })).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox'));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Close plan' }));
    });
    expect(
      await screen.findByText(/Closure outcome unconfirmed/)
    ).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Close plan' })).toBeNull();
    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'Refresh plan closure' })
      );
    });
    expect(
      await screen.findByText(
        'Plan closed. No refund issued; no provider wallet deleted.'
      )
    ).toBeVisible();
    expect(posts).toBe(1);
    const observer = await fixture.admin();
    try {
      expect(
        (
          await observer.query(
            'SELECT count(*)::int AS count FROM piggyvest_draft_closure.receipts WHERE goal_id=$1',
            [goalId]
          )
        ).rows
      ).toEqual([{ count: 1 }]);
      expect(
        (
          await observer.query(
            'SELECT count(*)::int AS count FROM piggyvest_savings_ledger.operations WHERE goal_id=$1',
            [goalId]
          )
        ).rows
      ).toEqual([{ count: 0 }]);
    } finally {
      await observer.end();
    }
    cleanup();
    const restarted = await createPiggyvestDraftClosureClientBinding({
      ...options,
      recovery: true,
    });
    render(<BoundDraftClosureReview source={source} binding={restarted} />);
    expect(screen.getByRole('status')).toHaveTextContent('Plan closed');
    expect(restarted.getFundingBlocked()).toBe(true);
    expect(posts).toBe(1);
  }
);

it.skipIf(!enabled)(
  'mapped goal displays reconciliation through actual HTTP without any close POST',
  async () => {
    const server = await fixture.server(1);
    listeners.push(server);
    const goalId = fixture.goal(1);
    const httpFetch = vi.fn<typeof globalThis.fetch>((input, init) => {
      const target = new URL(String(input));
      if (target.origin !== server.origin)
        throw new Error('External HTTP prohibited');
      return fetch(target, {
        ...init,
        headers: {
          ...Object.fromEntries(new Headers(init?.headers)),
          cookie: 'synthetic-session=owner',
          origin: server.origin,
        },
      });
    });
    const source = piggyvestSavingsScreenSchema.parse({
      environment: 'staging',
      status: 'ready',
      sessionKey: 'synthetic',
      goalId,
      policy: {
        status: 'draft',
        goalId,
        revisionId: goalId,
        device: { productName: 'Synthetic', variant: null, condition: 'New' },
        terms: {
          version: 'synthetic-v1',
          hash: 'a'.repeat(64),
          text: 'Synthetic terms only.',
        },
        consent: 'accepted',
      },
      eligibility: { status: 'unavailable' },
      funding: { status: 'unavailable' },
      progress: { status: 'unavailable' },
    });
    const binding = await createPiggyvestDraftClosureClientBinding({
      source,
      operationId: goalId,
      tenantKey: 'synthetic',
      isCurrent: () => true,
      http: {
        configuration: {
          mode: 'local_test',
          baseUrl: server.origin,
          endpointPath: '/close-plan',
        },
        fetch: httpFetch,
        getCsrfToken: async () => {
          throw new Error('Read-only fixture');
        },
      },
    });
    render(<BoundDraftClosureReview source={source} binding={binding} />);
    expect(screen.getByRole('status')).toHaveTextContent(
      'requires reconciliation'
    );
    expect(screen.queryByRole('button', { name: 'Close plan' })).toBeNull();
    expect(
      httpFetch.mock.calls.every((call) => call[1]?.method === 'GET')
    ).toBe(true);
  }
);
