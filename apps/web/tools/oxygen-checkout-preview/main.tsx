import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { OxygenCheckoutFlow } from '../../src/components/payments/oxygen/OxygenCheckoutFlow';
import { createSimulatedOxygenCheckout } from '../../src/lib/payments/oxygen/simulated-checkout';
import './styles.css';

function Preview() {
  const [adapter, setAdapter] = useState(createSimulatedOxygenCheckout);
  return (
    <>
      <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-2 px-5 pt-5 text-xs text-gray-500 sm:px-8">
        <span>Local preview · refreshing starts a new simulation</span>
        <button
          type="button"
          className="min-h-11 rounded-lg border bg-white px-3 text-gray-700"
          onClick={() => setAdapter(createSimulatedOxygenCheckout())}
        >
          Reset simulation
        </button>
      </div>
      <OxygenCheckoutFlow adapter={adapter} />
    </>
  );
}
const root = document.getElementById('root');
if (!root) throw new Error('Preview root missing');
createRoot(root).render(<Preview />);
