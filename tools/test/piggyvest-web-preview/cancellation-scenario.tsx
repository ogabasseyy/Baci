import { useState } from 'react';
import { CancellationReview } from '../../../apps/web/src/components/storefront/piggyvest-savings/cancellation-review';
import { createCancellationFixture } from './cancellation-fixture';

export function CancellationScenario() {
  const [goal, setGoal] = useState<'a' | 'b'>('a');
  const [session, setSession] = useState<'a' | 'b' | 'none'>('a');
  const [available, setAvailable] = useState(true);
  const [result, setResult] = useState<'prepared' | 'uncertain'>('prepared');
  const [fixtures] = useState(() => ({
    a: {
      prepared: createCancellationFixture('a', 'prepared'),
      uncertain: createCancellationFixture('a', 'uncertain'),
    },
    b: {
      prepared: createCancellationFixture('b', 'prepared'),
      uncertain: createCancellationFixture('b', 'uncertain'),
    },
  }));
  const fixture = fixtures[goal][result];
  return (
    <section aria-label="Synthetic cancellation fixture">
      <h2>SYNTHETIC cancellation — isolated UI fixture</h2>
      <p>
        Every quote and result below is invented in browser memory only. No
        actual reservation, refund, collection pause or provider dispatch
        occurs. Even “Prepared” and “Reservation may be retained” are simulated
        display states, not server acknowledgements. Reload resets this fixture.
      </p>
      <fieldset className="qa-controls">
        <legend>Cancellation fixture controls — separate from savings</legend>
        <label>
          Cancellation quote
          <select
            value={available ? 'available' : 'unavailable'}
            onChange={(event) =>
              setAvailable(event.target.value === 'available')
            }
          >
            <option value="available">Available — synthetic amounts</option>
            <option value="unavailable">Unavailable</option>
          </select>
        </label>
        <label>
          Cancellation result
          <select
            value={result}
            onChange={(event) =>
              setResult(
                event.target.value === 'uncertain' ? 'uncertain' : 'prepared'
              )
            }
          >
            <option value="prepared">Prepared — simulated only</option>
            <option value="uncertain">Uncertain — simulated only</option>
          </select>
        </label>
        <label>
          Cancellation goal
          <select
            value={goal}
            onChange={(event) =>
              setGoal(event.target.value === 'b' ? 'b' : 'a')
            }
          >
            <option value="a">Synthetic goal A</option>
            <option value="b">Synthetic goal B</option>
          </select>
        </label>
        <label>
          Cancellation session
          <select
            value={session}
            onChange={(event) => {
              const value = event.target.value;
              if (value === 'a' || value === 'b' || value === 'none')
                setSession(value);
            }}
          >
            <option value="a">Synthetic session A</option>
            <option value="b">Synthetic session B</option>
            <option value="none">No session</option>
          </select>
        </label>
      </fieldset>
      <p>Stable synthetic operation ID: {fixture.operationId}</p>
      <p>
        Choose a result before preparing. Reload to reset an attempted
        operation.
      </p>
      <CancellationReview
        sessionKey={session === 'none' ? null : `synthetic-cancel-${session}`}
        goalId={fixture.quote.goalId}
        operationId={fixture.operationId}
        quote={
          available
            ? fixture.quote
            : { status: 'unavailable', goalId: fixture.quote.goalId }
        }
        onPrepare={fixture.prepare}
      />
    </section>
  );
}
