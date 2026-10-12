import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CancellationReview } from '@/components/storefront/piggyvest-savings/cancellation-review';
import { CANCEL_PLAN_STATEMENTS } from './cancel-plan-statements';
import { customerCancelFlowFixture } from './customer-cancel-flow.test-support';
import { createPiggyvestPostgresExecutor } from './postgres-executor';

vi.mock('server-only', () => ({}));

const externalFetch = vi.fn(() => {
  throw new Error('External HTTP prohibited in synthetic cancellation bridge');
});

beforeEach(() => {
  externalFetch.mockClear();
  vi.stubGlobal('fetch', externalFetch);
});

afterEach(() => {
  try {
    expect(externalFetch).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
  }
});

function confirm() {
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'Prepare cancellation' }));
}

describe('customer cancellation with in-process HTTP and synthetic auth', () => {
  it('connects the actual UI, CSRF handler and adapter without provider dispatch', async () => {
    const test = customerCancelFlowFixture();
    const quote = await test.load();
    render(
      <CancellationReview
        sessionKey="synthetic-cancel-session"
        goalId={test.goalId}
        operationId={test.operationId}
        quote={quote}
        onPrepare={test.prepare}
      />
    );
    expect(
      screen.getByRole('button', { name: 'Prepare cancellation' })
    ).toBeDisabled();
    confirm();
    await screen.findByText(/Prepared only\. Not refunded\./);
    expect(test.prepare).toHaveBeenCalledOnce();
    expect(test.preparedCommands()).toEqual([
      expect.objectContaining({ actorId: test.actorId, accepted: true }),
    ]);
    expect(test.publicCommands()).toEqual([
      expect.objectContaining({
        accepted: true,
        operationId: test.operationId,
      }),
    ]);
    expect(test.publicCommands()[0]).not.toHaveProperty('actorId');
    expect(test.events[0]).toBe('auth');
    test.assertOnlyCancellationSql();
  });

  it('rejects sign-out before CSRF and policy storage', async () => {
    const test = customerCancelFlowFixture();
    test.signOut();
    const response = await test.postRaw(null);
    expect(response.status).toBe(401);
    expect(test.csrf).not.toHaveBeenCalled();
    expect(test.execute).not.toHaveBeenCalled();
    expect(test.from).not.toHaveBeenCalled();
  });

  it('rejects a missing CSRF token before cancellation storage', async () => {
    const test = customerCancelFlowFixture();
    const response = await test.postRaw({}, false);
    expect(response.status).toBe(403);
    expect(test.execute).not.toHaveBeenCalled();
  });
});

describe.skipIf(process.env.PIGGYVEST_RUN_CUSTOMER_CANCEL_RUNTIME !== '1')(
  'real restricted PostgreSQL with synthetic Supabase identity and in-process HTTP',
  () => {
    function fixture(sequence: 201 | 202) {
      return customerCancelFlowFixture({
        sequence,
        database: createPiggyvestPostgresExecutor({
          environment: 'staging',
          transport: 'local_test',
          socketDirectory: process.env.PIGGYVEST_LOCAL_TEST_SOCKET,
          database: 'piggyvest_local',
          password: 'synthetic-local-only',
          role: 'piggyvest_staging_policy_writer',
          port: 55446,
        }),
      });
    }

    it('prepares from the actual UI and replays exactly without a second quote or dispatch', async () => {
      const test = fixture(201);
      const quote = await test.load();
      expect(quote).toMatchObject({
        status: 'quote_available',
        principalKobo: 100,
        paidInterestKobo: 7,
        pendingInterestKobo: 3,
        dispatch: 'contract_gap',
        interestDisposition: 'unresolved',
      });
      render(
        <CancellationReview
          sessionKey="synthetic-pg-cancel-session"
          goalId={test.goalId}
          operationId={test.operationId}
          quote={quote}
          onPrepare={test.prepare}
        />
      );
      confirm();
      await screen.findByText(/Prepared only\. Not refunded\./);
      const original = test.publicCommands()[0];
      const executed = test.execute.mock.calls.length;
      const replay = await test.prepare(original);
      expect(replay).toEqual(await test.prepare.mock.results[0].value);
      expect(replay).toMatchObject({
        status: 'prepared',
        goalId: test.goalId,
        operationId: test.operationId,
        collectionPaused: true,
        dispatch: 'contract_gap',
        interestDisposition: 'unresolved',
      });
      expect(
        test.execute.mock.calls.slice(executed).map(([statement]) => statement)
      ).toEqual([CANCEL_PLAN_STATEMENTS.prepareCancelPlan.text]);
      const commands = test.preparedCommands();
      expect(commands).toHaveLength(2);
      expect(commands[1]).toEqual(commands[0]);
      expect(test.publicCommands()[1]).toEqual(original);
      test.assertOnlyCancellationSql();
    });

    it('rejects a stale displayed principal against current SQL amounts without claiming release', async () => {
      const test = fixture(202);
      const quote = await test.load();
      if (quote.status !== 'quote_available')
        throw new Error('Missing synthetic quote');
      render(
        <CancellationReview
          sessionKey="synthetic-pg-stale-session"
          goalId={test.goalId}
          operationId={test.operationId}
          quote={{ ...quote, principalKobo: quote.principalKobo - 1 }}
          onPrepare={test.prepare}
        />
      );
      confirm();
      await screen.findByText(/Reservation may be retained/);
      expect(screen.queryByText(/Prepared only/)).toBeNull();
      expect(test.preparedCommands()).toEqual([
        expect.objectContaining({ principalKobo: quote.principalKobo - 1 }),
      ]);
      test.assertOnlyCancellationSql();
    });
  }
);
