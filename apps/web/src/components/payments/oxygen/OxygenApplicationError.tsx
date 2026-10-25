import {
  oxygenActiveLoanMessage,
  oxygenStatementRequiredMessage,
} from '@/lib/payments/oxygen/booking-rejection';
import { oxygenButtonClass as button } from './oxygen-checkout-styles';
import { oxygenRateLimitMessage } from './use-oxygen-provider';

type Props = {
  activeLoan: boolean;
  retryBreakdown?: boolean;
  error: string;
  validated?: boolean;
  stage?: string;
  merchantSlug?: string;
  busy: boolean;
  refresh: () => Promise<unknown>;
};

/** Static customer recovery copy; provider diagnostic bodies remain private. */
export function OxygenApplicationError({
  activeLoan,
  retryBreakdown = false,
  error,
  validated,
  stage,
  merchantSlug,
  busy,
  refresh,
}: Props) {
  return (
    <div className="mx-auto grid max-w-md gap-4 rounded-2xl bg-gray-50 p-6 text-center">
      {(validated || activeLoan) && (
        <h3 className="text-xl font-bold text-gray-900">
          {activeLoan
            ? 'You already have an active Oxygen loan'
            : stage === 'plan_required'
              ? 'We couldn’t prepare your payment plan'
              : 'We couldn’t complete this check'}
        </h3>
      )}
      <p role="alert" className="text-sm leading-relaxed text-gray-600">
        {activeLoan
          ? oxygenActiveLoanMessage
          : error === oxygenRateLimitMessage ||
              error === oxygenStatementRequiredMessage
            ? error
            : 'We couldn’t complete this step right now. Your progress is saved.'}
      </p>
      {activeLoan ? (
        merchantSlug ? (
          <a className={button} href={`/${merchantSlug}/contact`}>
            Contact support
          </a>
        ) : null
      ) : (
        <button
          className={button}
          type="button"
          disabled={busy}
          onClick={() => void refresh()}
        >
          {retryBreakdown ? 'Retry payment breakdown' : 'Check for an update'}
        </button>
      )}
    </div>
  );
}
