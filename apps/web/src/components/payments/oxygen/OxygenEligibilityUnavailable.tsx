export function OxygenEligibilityUnavailable() {
  return (
    <div className="mx-auto grid max-w-md gap-3 py-8 text-center">
      <h3 className="text-xl font-bold text-gray-900">
        No installment plan is available right now
      </h3>
      <p className="text-sm leading-relaxed text-gray-500">
        Your application is saved. You can close this window and choose another
        payment method at checkout.
      </p>
    </div>
  );
}
