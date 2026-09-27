'use client';

import { useEffect, useState } from 'react';

const scenarioCookie = 'checkout-qa-scenario';

function writeScenario(value: string) {
  // biome-ignore lint/suspicious/noDocumentCookie: isolated browser fixture selects the local route scenario
  document.cookie = `${scenarioCookie}=${value}; Path=/; SameSite=Lax`;
}

export function ManualQaControls() {
  const [scenario, setScenario] = useState('success');
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    setVisible(
      new URLSearchParams(window.location.search).get('qa') === 'manual'
    );
    const match = document.cookie.match(/(?:^|; )checkout-qa-scenario=([^;]*)/);
    if (match?.[1]) setScenario(decodeURIComponent(match[1]));
  }, []);

  function selectScenario(value: string) {
    setScenario(value);
    writeScenario(value);
    window.location.reload();
  }

  function reset() {
    localStorage.removeItem('baci-cart-ogabassey-guest');
    sessionStorage.removeItem('checkout-form');
    sessionStorage.removeItem('storefront-checkout-pending-order');
    writeScenario('success');
    window.location.assign('/cart?qaReset=1');
  }

  if (!visible) return null;

  return (
    <aside
      aria-label="Manual checkout QA fixtures"
      style={{
        background: '#fff7df',
        border: '1px solid #d4a72c',
        borderRadius: 8,
        margin: '12px auto',
        maxWidth: 1100,
        padding: 12,
      }}
    >
      <strong>Local checkout QA fixtures</strong>
      <p style={{ margin: '4px 0 8px' }}>
        Synthetic local API only. No provider calls or real orders.
      </p>
      <label>
        Payment scenario{' '}
        <select
          aria-label="Payment scenario"
          value={scenario}
          onChange={(event) => selectScenario(event.target.value)}
        >
          <option value="success">Payment initialization succeeds</option>
          <option value="provider-error">
            Provider error on every attempt
          </option>
        </select>
      </label>{' '}
      <button type="button" onClick={reset}>
        Reset checkout fixtures
      </button>
    </aside>
  );
}
