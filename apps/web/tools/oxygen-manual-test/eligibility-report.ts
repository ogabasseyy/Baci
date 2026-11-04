import { oxygenEligibilityReportSchema } from '../../src/schemas/oxygen-eligibility-report';

const statuses = [
  'ELIGIBLE',
  'NOT_ELIGIBLE',
  'PENDING',
  'PROCESSING',
  'ACTIVE',
  'COMPLETED',
  'SUCCESS',
  'FAILED',
  'REJECTED',
  'DECLINED',
] as const;
export interface EligibilityReport {
  isEligible: boolean;
  providerStatus: (typeof statuses)[number] | 'UNRECOGNIZED';
  nextStep:
    | 'check_remaining_kyc'
    | 'wait_for_review'
    | 'confirm_credit_limit_and_remaining_kyc'
    | 'reconcile_status_with_oxygen';
  limits?: {
    currency: 'NGN';
    unit: 'naira';
    eligibleAmount: number;
    maxLoanAmount: number;
    minimumLoanAmount: number;
    limitsMatch: boolean;
  };
  // Unit is not yet confirmed by Oxygen; do not label this months.
  maxTenure?: number;
}

export function readEligibilityReport(
  body: unknown,
  httpStatus: number,
  requestReference: string,
  partnerReference: string
): EligibilityReport | undefined {
  if (httpStatus !== 200) return undefined;
  const parsed = oxygenEligibilityReportSchema.safeParse(body);
  if (!parsed.success) return undefined;
  const data = parsed.data;
  if (
    data.loan_request_reference !== requestReference ||
    data.partner_reference !== partnerReference
  )
    return undefined;
  const providerStatus =
    statuses.find((status) => status === data.status) ?? 'UNRECOGNIZED';
  if (
    (!data.is_eligible && providerStatus === 'ELIGIBLE') ||
    (data.is_eligible &&
      [
        'NOT_ELIGIBLE',
        'FAILED',
        'REJECTED',
        'DECLINED',
        'PENDING',
        'PROCESSING',
      ].includes(providerStatus))
  )
    return undefined;
  const amounts = [
    data.eligible_amount,
    data.max_loan_amount,
    data.minimum_loan_amount,
  ];
  const hasAmounts = amounts.some((amount) => amount !== undefined);
  if (
    hasAmounts &&
    (data.eligible_amount === undefined ||
      data.max_loan_amount === undefined ||
      data.minimum_loan_amount === undefined ||
      data.minimum_loan_amount >
        Math.min(data.eligible_amount, data.max_loan_amount))
  )
    return undefined;
  if (hasAmounts && (!data.is_eligible || providerStatus !== 'COMPLETED'))
    return undefined;
  const report: EligibilityReport = {
    isEligible: data.is_eligible,
    providerStatus,
    nextStep: data.is_eligible
      ? 'confirm_credit_limit_and_remaining_kyc'
      : ['PENDING', 'PROCESSING'].includes(providerStatus)
        ? 'wait_for_review'
        : 'reconcile_status_with_oxygen',
  };
  if (
    data.eligible_amount !== undefined &&
    data.max_loan_amount !== undefined &&
    data.minimum_loan_amount !== undefined
  ) {
    report.limits = {
      currency: 'NGN',
      unit: 'naira',
      eligibleAmount: data.eligible_amount,
      maxLoanAmount: data.max_loan_amount,
      minimumLoanAmount: data.minimum_loan_amount,
      limitsMatch: data.eligible_amount === data.max_loan_amount,
    };
    report.nextStep = report.limits.limitsMatch
      ? 'check_remaining_kyc'
      : 'reconcile_status_with_oxygen';
  }
  if (data.max_tenure !== undefined) report.maxTenure = data.max_tenure;
  return report;
}
