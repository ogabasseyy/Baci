import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { SavingsScreen } from '../../../apps/web/src/components/storefront/piggyvest-savings/savings-screen';
import { CancellationScenario } from './cancellation-scenario';
import { createFixture } from './fixtures';
import { createScreenSource } from './screen-source';
import './styles.css';

function Scenario({
  variant,
  funding,
  progress,
  session,
  failConsent,
}: {
  variant: 'green' | 'blue';
  funding: 'ready' | 'pending' | 'unavailable';
  progress: 'ready' | 'loading' | 'pending_wallet' | 'unavailable';
  session: boolean;
  failConsent: boolean;
}) {
  const [fixture] = useState(() => createFixture(variant, failConsent));
  const [policy, setPolicy] = useState(fixture.draft);
  const [eligibility, setEligibility] = useState<
    'blocked' | 'pending' | 'unavailable' | 'allowed'
  >('blocked');
  const [submitPolicy] = useState(
    () => async (input: Parameters<typeof fixture.submit>[0]) => {
      const accepted = await fixture.submit(input);
      setPolicy(accepted);
      return accepted;
    }
  );
  const source = createScreenSource({
    policy,
    session,
    eligibility,
    funding,
    progress,
  });
  return (
    <>
      <fieldset className="qa-controls" disabled={!session}>
        <legend>Independent synthetic server projection</legend>
        <label>
          Synthetic trusted eligibility
          <select
            value={eligibility}
            onChange={(event) => {
              const value = event.target.value;
              if (
                value === 'blocked' ||
                value === 'pending' ||
                value === 'unavailable' ||
                (value === 'allowed' && policy.consent === 'accepted')
              )
                setEligibility(value);
            }}
          >
            <option value="blocked">Blocked — default</option>
            <option value="pending">Pending</option>
            <option value="unavailable">Unavailable</option>
            <option value="allowed" disabled={policy.consent !== 'accepted'}>
              Allowed — explicit fixture only
            </option>
          </select>
        </label>
        <p>
          Recording simulated consent does not grant eligibility. This separate
          control invents a local test projection only.
        </p>
      </fieldset>
      <SavingsScreen source={source} submitPolicy={submitPolicy} />
    </>
  );
}
export function PreviewApp() {
  const [variant, setVariant] = useState<'green' | 'blue'>('green');
  const [funding, setFunding] = useState<'ready' | 'pending' | 'unavailable'>(
    'pending'
  );
  const [progress, setProgress] = useState<
    'ready' | 'loading' | 'pending_wallet' | 'unavailable'
  >('ready');
  const [session, setSession] = useState(true);
  const [failConsent, setFailConsent] = useState(false);
  return (
    <main>
      <header>
        <strong>SYNTHETIC / STAGING — LOCAL UI QA ONLY</strong>
        <h1>Savings review fixture</h1>
        <p>
          No real accounts, provider responses, customer data or money
          operations. All amounts are invented internal-ledger display fixtures.
          Consent is simulated; reload resets it.
        </p>
      </header>
      <fieldset className="qa-controls">
        <legend>Fixture controls</legend>
        <label>
          Exact variant and condition
          <select
            value={variant}
            onChange={(event) =>
              setVariant(event.target.value === 'blue' ? 'blue' : 'green')
            }
          >
            <option value="green">128 GB / Green — Used, excellent</option>
            <option value="blue">256 GB / Blue — New</option>
          </select>
        </label>
        <label>
          Funding response
          <select
            value={funding}
            onChange={(event) => {
              const value = event.target.value;
              if (
                value === 'ready' ||
                value === 'pending' ||
                value === 'unavailable'
              )
                setFunding(value);
            }}
          >
            <option value="pending">Pending</option>
            <option value="unavailable">Unavailable</option>
            <option value="ready">Ready — non-bank placeholder</option>
          </select>
        </label>
        <label>
          Savings progress
          <select
            value={progress}
            onChange={(event) => {
              const value = event.target.value;
              if (
                value === 'ready' ||
                value === 'loading' ||
                value === 'pending_wallet' ||
                value === 'unavailable'
              )
                setProgress(value);
            }}
          >
            <option value="ready">Synthetic progress</option>
            <option value="loading">Loading</option>
            <option value="pending_wallet">Pending wallet</option>
            <option value="unavailable">Unavailable</option>
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            checked={session}
            onChange={(event) => setSession(event.target.checked)}
          />
          Synthetic session present
        </label>
        <label>
          <input
            type="checkbox"
            checked={failConsent}
            onChange={(event) => setFailConsent(event.target.checked)}
          />
          Simulate consent failure
        </label>
      </fieldset>
      <Scenario
        key={JSON.stringify([variant, session, failConsent])}
        variant={variant}
        funding={funding}
        progress={progress}
        session={session}
        failConsent={failConsent}
      />
      <CancellationScenario />
    </main>
  );
}

const container = document.getElementById('root');
if (container) createRoot(container).render(<PreviewApp />);
