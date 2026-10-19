import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { SavingsScreen } from '@/components/storefront/piggyvest-savings/savings-screen';
import { customerScreenFlowFixture as fixture } from './customer-screen-flow.test-support';
import { recordPiggyvestGoalLifecycleTerms } from './goal-lifecycle-terms';
import { createGoalPolicyStore } from './goal-policy-store';
import { GOAL_POLICY_STATEMENTS } from './goal-policy-store-statements';
import { createPiggyvestPostgresExecutor } from './postgres-executor';

vi.mock('server-only', () => ({}));

it('connects shared HTTP client, auth context, CSRF, store and actual screen without enabling funds', async () => {
  const test = fixture();
  const source = await test.readScreen();
  expect(source.status).toBe('ready');
  render(<SavingsScreen source={source} submitPolicy={test.client.submit} />);
  expect(await screen.findByRole('checkbox')).not.toBeChecked();
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'Accept draft terms' }));
  await screen.findByText('Consent recorded for this draft.');
  await expect(test.client.load(test.goalId)).resolves.toMatchObject({
    consent: 'accepted',
  });
  expect(await test.readScreen()).toMatchObject({
    policy: { consent: 'accepted' },
    eligibility: { status: 'unavailable' },
    funding: { status: 'unavailable' },
    progress: { status: 'unavailable' },
  });
  expect(screen.queryByRole('region', { name: 'Funding details' })).toBeNull();
  expect(
    test.execute.mock.calls.every(([statement]) =>
      new Set<string>([
        GOAL_POLICY_STATEMENTS.readGoalPolicy.text,
        GOAL_POLICY_STATEMENTS.acceptGoalPolicy.text,
      ]).has(statement)
    )
  ).toBe(true);
});

it('redacts an ownership failure through the shared client without touching policy storage', async () => {
  const test = fixture();
  test.rows.customers = {
    id: test.goalId,
    merchant_id: test.goalId,
    user_id: test.goalId,
  };
  await expect(test.client.load(test.goalId)).rejects.toThrow(
    /^Policy unavailable$/
  );
  expect(test.execute).not.toHaveBeenCalled();
});

it('removes the composed draft after sign-out and rejects subsequent client reads', async () => {
  const test = fixture();
  const { rerender } = render(
    <SavingsScreen source={await test.readScreen()} />
  );
  await screen.findByRole('checkbox');
  test.signOut();
  test.execute.mockClear();
  rerender(<SavingsScreen source={await test.readScreen()} />);
  expect(screen.queryByRole('checkbox')).toBeNull();
  await expect(test.client.load(test.goalId)).rejects.toThrow(
    /^Policy unavailable$/
  );
  expect(test.execute).not.toHaveBeenCalled();
});

it.skipIf(process.env.PIGGYVEST_RUN_CUSTOMER_SCREEN_RUNTIME !== '1')(
  'records consent through the shared client and real restricted PostgreSQL without posting money',
  async () => {
    const database = {
      environment: 'staging',
      transport: 'local_test',
      socketDirectory: process.env.PIGGYVEST_LOCAL_TEST_SOCKET,
      database: 'piggyvest_local',
      password: 'synthetic-local-only',
      port: 55443,
      role: 'piggyvest_staging_policy_writer',
    };
    const execute = createPiggyvestPostgresExecutor(database);
    const test = fixture(execute);
    const store = createGoalPolicyStore({
      configuration: {
        environment: 'staging',
        goalId: test.goalId,
        integrationId: '40000000-0000-4000-8000-000000000001',
        merchantId: '10000000-0000-4000-8000-000000000001',
        customerId: '20000000-0000-4000-8000-000000000001',
        expectedBusinessId: 'synthetic-business',
      },
      execute,
    });
    await store.stage({
      revisionId: test.revisionId,
      expectedGoalUpdatedAt: '2026-09-12T00:00:00Z',
      productId: '50000000-0000-4000-8000-000000000001',
      variantId: '60000000-0000-4000-8000-000000000001',
      termsVersion: test.terms.version,
      termsHash: test.terms.hash,
      quoteId: 'synthetic-connected-quote',
      quoteKobo: 100000,
      quoteExpiresAt: '2099-01-01T00:00:00Z',
      guarantee: null,
      lifecycle: 'draft',
      collectionPaused: true,
    });
    await recordPiggyvestGoalLifecycleTerms({
      enabled: true,
      database,
      scope: {
        environment: 'staging',
        goalId: test.goalId,
        integrationId: '40000000-0000-4000-8000-000000000001',
        merchantId: '10000000-0000-4000-8000-000000000001',
        customerId: '20000000-0000-4000-8000-000000000001',
        expectedBusinessId: 'synthetic-business',
      },
      command: {
        action: 'prepare',
        revisionId: test.revisionId,
        durationMonths: 1,
      },
    });
    const policy = await test.client.load(test.goalId);
    expect(policy).toMatchObject({ consent: 'required', durationMonths: 1 });
    const acceptance = {
      goalId: test.goalId,
      revisionId: test.revisionId,
      termsVersion: test.terms.version,
      termsHash: test.terms.hash,
      accepted: true,
    };
    await expect(test.client.submit(acceptance)).rejects.toThrow(
      'Policy unavailable'
    );
    const durationAcceptance = { ...acceptance, durationMonths: 1 };
    await expect(test.client.submit(durationAcceptance)).resolves.toMatchObject(
      {
        consent: 'accepted',
      }
    );
    await expect(test.client.submit(durationAcceptance)).resolves.toMatchObject(
      {
        consent: 'accepted',
      }
    );
    expect(await store.read()).toMatchObject({
      actorId: '90000000-0000-4000-8000-000000000001',
    });
    expect(await test.readScreen()).toMatchObject({
      eligibility: { status: 'unavailable' },
    });
  }
);
