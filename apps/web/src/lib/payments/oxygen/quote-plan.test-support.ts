const id = '60000000-0000-4000-8000-000000000001';
const ref = '70000000-0000-4000-8000-000000000001';
const booking = {
  loan_reference: ref,
  product_amount: 400000,
  equity_percentage: 35,
  equity_amount: 140000,
  loan_amount: 260000,
  loan_tenure: 6,
  status: 'BOOKED' as const,
};
const kyc = {
  bvn_status: 'DONE',
  nin_status: 'DONE',
  bank_status: 'DONE',
  phone_status: 'DONE',
  selfie_status: 'DONE',
  address_status: 'DONE',
};
const state = {
  bookingReference: ref,
  booking,
  kyc,
  validated: true,
  eligible: true,
  eligibleAmount: 400000,
  minimumAmount: 10000,
  maxTenure: 12,
  offers: [{ tenure: 6, loanAmount: 400000 }],
};

export const oxygenQuoteFixture = { id, ref, booking, kyc, state };
