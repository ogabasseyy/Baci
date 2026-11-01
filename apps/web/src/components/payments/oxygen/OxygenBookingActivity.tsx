import { OxygenVerificationActivity } from './OxygenVerificationActivity';
export function OxygenBookingActivity() {
  return (
    <div
      role="status"
      className="mx-auto grid max-w-md justify-items-center gap-5 py-8 text-center"
    >
      <OxygenVerificationActivity />
      <div className="space-y-2">
        <h3 className="text-xl font-bold text-gray-900">
          Booking your selected payment plan
        </h3>
        <p className="text-sm leading-relaxed text-gray-500">
          We’re confirming your chosen down payment and repayment period with
          Oxygen.
        </p>
      </div>
      <p className="text-xs text-gray-400">
        Please keep this window open. This does not approve or activate your
        plan.
      </p>
    </div>
  );
}
