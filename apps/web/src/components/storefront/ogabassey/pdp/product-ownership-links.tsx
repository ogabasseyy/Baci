import type { Route } from 'next';

/** Informational links only. Actual payment eligibility and terms remain in checkout. */
export function ProductOwnershipLinks({ cartHref }: { cartHref: Route }) {
  const basePath = cartHref.replace(/\/cart\/?$/, '');
  return (
    <div data-ogabassey-pdp-ownership>
      <details>
        <summary>Prefer to spread your payments?</summary>
        <p>
          Check the payment options available to you at checkout. Eligibility,
          fees and repayment terms are confirmed before you commit.
        </p>
      </details>
      <details>
        <summary>Or save towards it, at your pace.</summary>
        <p>Explore your wallet and plan your next device.</p>
        <a href={`${basePath}/wallet`}>Open your wallet ↗</a>
      </details>
    </div>
  );
}
