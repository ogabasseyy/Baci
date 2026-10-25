export type ProbeKycStatus = 'DONE' | 'NOT_DONE' | 'PROCESSING' | 'UNKNOWN';
export interface ProbeRecovery {
  code?: string;
  kyc?: { address: ProbeKycStatus; selfie: ProbeKycStatus } & Partial<
    Record<'nin' | 'bvn' | 'bank' | 'phone', ProbeKycStatus>
  >;
}
function status(value: unknown): ProbeKycStatus {
  return value === 'DONE' || value === 'NOT_DONE' || value === 'PROCESSING'
    ? value
    : 'UNKNOWN';
}
export function classifyProbeRecovery(
  action: string,
  ok: boolean,
  data: unknown
): ProbeRecovery {
  const fields =
    typeof data === 'object' && data !== null
      ? (data as Record<string, unknown>)
      : {};
  if (action === 'selfie' && !ok && fields.message === 'BVN already exists')
    return { code: 'existing_bvn_recovery_required' };
  if (action === 'kyc' && ok)
    return {
      code: 'kyc_status_received',
      kyc: {
        address: status(fields.address_status),
        selfie: status(fields.selfie_status),
        ...Object.fromEntries(
          ['nin', 'bvn', 'bank', 'phone']
            .filter((key) => Object.hasOwn(fields, `${key}_status`))
            .map((key) => [key, status(fields[`${key}_status`])])
        ),
      },
    };
  if (
    ok &&
    ((action === 'validate-new' &&
      fields.message === 'Account validation successful') ||
      (action === 'validate-existing' &&
        fields.message === 'OTP validation successful'))
  )
    return { code: 'customer_validated' };
  if (
    action === 'resend-otp' &&
    ok &&
    (fields.message === 'OTP retriggered for validation' ||
      fields.Message === 'OTP retriggered for validation')
  )
    return { code: 'otp_resend_accepted' };
  return {};
}
