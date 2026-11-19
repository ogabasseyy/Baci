import type { OxygenRuntimeSnapshot } from '@/schemas/oxygen-runtime-view';
import { OxygenPlanForm } from './OxygenPlanForm';
import { oxygenButtonClass } from './oxygen-checkout-styles';
import type { useOxygenProvider } from './use-oxygen-provider';

type Props = {
  state: OxygenRuntimeSnapshot['state'];
  productAmount?: number;
  disabled: boolean;
  submit: ReturnType<typeof useOxygenProvider>['submit'];
};
export function OxygenPlanRequired({
  state,
  productAmount,
  disabled,
  submit,
}: Props) {
  if (!state?.offers?.length)
    return (
      <div role="status">
        <p>We need to update your payment options before you continue.</p>
        <p>
          If Oxygen can’t provide them, close this window and choose another
          payment method.
        </p>
        <button
          type="button"
          className={oxygenButtonClass}
          disabled={disabled}
          onClick={() => void submit({ action: 'refresh_eligibility' })}
        >
          Update payment options
        </button>
      </div>
    );
  return (
    <OxygenPlanForm
      key={`${productAmount}:${state.eligibleAmount}:${state.minimumAmount}:${state.maxTenure}:${JSON.stringify(state.offers)}`}
      busy={disabled}
      maxTenure={state.maxTenure}
      productAmount={productAmount}
      eligibleAmount={state.eligibleAmount}
      minimumAmount={state.minimumAmount}
      offers={state.offers}
      submit={submit}
    />
  );
}
