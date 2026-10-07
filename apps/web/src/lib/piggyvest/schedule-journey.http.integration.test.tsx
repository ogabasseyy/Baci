import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BoundScheduleReview } from '@/components/storefront/piggyvest-savings/schedule-binding';
import { startScheduleJourneyFixture } from './schedule-journey.http-support';
import { SCHEDULE_STORE_STATEMENTS } from './schedule-store-statements';

vi.mock('server-only', () => ({}));
const enabled = process.env.PIGGYVEST_RUN_SCHEDULE_JOURNEY === '1';
const expired = process.env.PIGGYVEST_SCHEDULE_EXPIRED === '1';
const restart = process.env.PIGGYVEST_SCHEDULE_RESTART === '1';
const originalResume = 'c0000000-0000-4000-8000-000000000005';
const listeners: Array<{ close: () => Promise<void> }> = [];
afterEach(async () => {
  cleanup();
  await Promise.all(listeners.splice(0).map((server) => server.close()));
});

describe.skipIf(!enabled)(
  'synthetic screen/auth session, actual HTTP/CSRF and restricted PostgreSQL schedule journey',
  () => {
    it.skipIf(expired || restart)(
      'persists explicit resume, recovers lost pause ACK without duplicate command, and leaves fresh consent for expiry',
      async () => {
        const fixture = await startScheduleJourneyFixture('c');
        listeners.push(fixture);
        render(
          <BoundScheduleReview
            source={fixture.source}
            binding={fixture.binding}
          />
        );
        expect(
          screen.getByRole('button', { name: 'Save resume proposal' })
        ).toBeDisabled();
        fireEvent.click(screen.getByRole('checkbox'));
        await act(async () => {
          fireEvent.click(
            screen.getByRole('button', { name: 'Save resume proposal' })
          );
        });
        expect(
          await screen.findByText(/Last recorded proposal: resume_proposed/)
        ).toBeVisible();
        fixture.loseNextPause();
        await act(async () => {
          fireEvent.click(
            screen.getByRole('button', { name: 'Pause schedule proposal' })
          );
        });
        expect(await screen.findByText(/Outcome unconfirmed/)).toBeVisible();
        await act(async () => {
          fireEvent.click(
            screen.getByRole('button', { name: 'Refresh schedule review' })
          );
        });
        expect(
          await screen.findByText(/Historical receipt:/)
        ).toHaveTextContent('paused');
        expect(screen.getByRole('checkbox')).not.toBeChecked();
        fireEvent.click(screen.getByRole('checkbox'));
        await act(async () => {
          fireEvent.click(
            screen.getByRole('button', { name: 'Save resume proposal' })
          );
        });
        await screen.findByText(/Last recorded proposal: resume_proposed/);
        const recovered = await fixture.client.read(originalResume);
        expect(recovered.state).toMatchObject({
          status: 'resume_proposed',
          version: 5,
        });
        expect(recovered.historical?.receipt.operationId).toBe(originalResume);
        const writes = fixture.execute.mock.calls.filter(
          ([statement]) =>
            statement === SCHEDULE_STORE_STATEMENTS.writeScheduleProposal.text
        );
        expect(writes).toHaveLength(5);
        expect(
          new Set(
            writes.map((call) => JSON.parse(String(call[1][6])).operationId)
          ).size
        ).toBe(5);
        expect(
          fixture.execute.mock.calls.every(([statement]) =>
            Object.values(SCHEDULE_STORE_STATEMENTS).some(
              (entry) => entry.text === statement
            )
          )
        ).toBe(true);
        expect(recovered.debitPermission).toBe(false);
      }
    );
    it.skipIf(!expired && !restart)(
      'safe observe commits expired proposal invalidation and restart keeps old receipt historical',
      async () => {
        const fixture = await startScheduleJourneyFixture(
          restart ? 'e' : 'd',
          originalResume
        );
        listeners.push(fixture);
        render(
          <BoundScheduleReview
            source={fixture.source}
            binding={fixture.binding}
          />
        );
        expect(screen.getByRole('status')).toHaveTextContent(
          'Last recorded proposal: paused'
        );
        expect(screen.getByText(/Historical receipt:/)).toHaveTextContent(
          'resume_proposed'
        );
        expect(screen.getByText(/Historical receipt:/)).toHaveTextContent(
          'History only'
        );
        const latest = await fixture.client.read(originalResume);
        expect(latest.state).toMatchObject({
          status: 'paused',
          consentProposal: null,
          version: restart ? 7 : 6,
        });
        expect(latest.historical?.receipt.state).toMatchObject({
          status: 'resume_proposed',
          version: 5,
        });
        expect(latest.debitPermission).toBe(false);
      }
    );
  }
);
