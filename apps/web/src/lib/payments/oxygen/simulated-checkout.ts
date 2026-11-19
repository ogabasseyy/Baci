import type {
  OxygenCheckoutAdapter,
  OxygenCheckoutQuote,
  OxygenCheckoutSnapshot,
} from './checkout';

// Observed staging examples for the user's NGN 400,000 product / tenure 3 only.
// These are NOT a production pricing formula or provider quote endpoint.
function quote(percentage: number): OxygenCheckoutQuote {
  const plans: Record<
    number,
    { equity: number; fees: number; instalments: number[] }
  > = {
    25: {
      equity: 10000000,
      fees: 592500,
      instalments: [11244100, 11244100, 11243990],
    },
    30: {
      equity: 12000000,
      fees: 553000,
      instalments: [10494500, 10494500, 10494376],
    },
    35: {
      equity: 14000000,
      fees: 513500,
      instalments: [9744900, 9744900, 9744762],
    },
  };
  if (![25, 30, 35].includes(percentage))
    throw new Error('Unsupported simulated plan');
  const plan = plans[percentage];
  const principal = 40000000 - plan.equity;
  const total = plan.instalments.reduce((sum, amount) => sum + amount, 0);
  return {
    productMinor: 40000000,
    equityPercentage: percentage,
    equityMinor: plan.equity,
    principalMinor: principal,
    chargesMinor: plan.fees,
    upfrontMinor: plan.equity + plan.fees,
    totalRepaymentMinor: total,
    interestMinor: total - principal,
    managementMinor: principal / 100,
    insuranceMinor: (principal * 9) / 1000,
    vatMinor: (principal * 75) / 100000,
    tenureMonths: 3,
    instalmentsMinor: plan.instalments,
  };
}

export function createSimulatedOxygenCheckout(): OxygenCheckoutAdapter {
  const session = `simulation-${crypto.randomUUID()}`;
  let sequence = 1;
  let paid = false;
  let setup = false;
  let snapshot: OxygenCheckoutSnapshot = {
    mode: 'simulation',
    bookingReference: `${session}:${sequence}`,
    phase: 'booked',
    quote: quote(35),
    paymentComplete: false,
    setupComplete: false,
    realActivation: 'not_requested',
    settlement: 'not_verified',
  };
  function requireReference(reference: string) {
    if (reference !== snapshot.bookingReference)
      throw new Error('Stale simulated booking');
  }
  function respond(work?: () => void) {
    return Promise.resolve().then(() => {
      work?.();
      return structuredClone(snapshot);
    });
  }
  return {
    mode: 'simulation',
    load: () => respond(),
    acceptOffer: (reference) =>
      respond(() => {
        requireReference(reference);
        if (snapshot.phase === 'simulation_complete')
          throw new Error('Already completed');
        snapshot.phase = 'approved';
      }),
    replaceBooking: (reference, percentage) =>
      respond(() => {
        requireReference(reference);
        if (paid || snapshot.phase === 'simulation_complete')
          throw new Error('Payment needs reconciliation');
        const replacement = quote(percentage);
        sequence++;
        paid = false;
        setup = false;
        snapshot = {
          ...snapshot,
          bookingReference: `${session}:${sequence}`,
          quote: replacement,
          phase: 'booked',
          paymentComplete: false,
          setupComplete: false,
        };
      }),
    simulateHostedCompletion: (reference, step) =>
      respond(() => {
        requireReference(reference);
        if (snapshot.phase !== 'approved')
          throw new Error('Accept the offer first');
        if (step === 'payment') paid = true;
        else if (step === 'setup') setup = true;
        else throw new Error('Unsupported simulated step');
      }),
    checkCompletion: (reference) =>
      respond(() => {
        requireReference(reference);
        snapshot.paymentComplete = paid;
        snapshot.setupComplete = setup;
      }),
    confirmPreview: (reference) =>
      respond(() => {
        requireReference(reference);
        if (snapshot.phase !== 'approved' || !paid || !setup)
          throw new Error('Complete the required steps');
        snapshot.paymentComplete = paid;
        snapshot.setupComplete = setup;
        snapshot.phase = 'simulation_complete';
      }),
  };
}
