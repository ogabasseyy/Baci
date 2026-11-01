import { classifyOxygenEligibility } from '../../src/lib/payments/oxygen/eligibility';
import { oxygenLoginResponseSchema } from '../../src/schemas/oxygen-login';
import {
  oxygenProbeCheckpointSchema,
  oxygenProbeCustomerSchema,
  oxygenProbeNameEnquirySchema,
  oxygenProbeOtpSchema,
  oxygenProbeResumeSchema,
} from '../../src/schemas/oxygen-probe';
import type { ProbeCheckpoint } from './checkpoint';
import {
  parseBanks,
  record,
  safeProviderDiagnostic,
  shape,
} from './diagnostics';
import {
  type EligibilityReport,
  readEligibilityReport,
} from './eligibility-report';
import { classifyProbeRecovery, type ProbeRecovery } from './recovery';
export interface ProbeConfig {
  baseUrl: string;
  environment: 'dev' | 'staging' | 'production';
  resumeRejectedCreate?: boolean;
  resumeState?: unknown;
  checkpoint?: unknown;
  persistCheckpoint?: (state: ProbeCheckpoint) => Promise<void>;
  reference: string;
  secret: string;
}
export interface ProbeResult {
  code: string;
  diagnostic?: string;
  kyc?: ProbeRecovery['kyc'];
  accountName?: string;
  banks?: { name: string; code: string }[];
  customerPath?: 'existing' | 'new' | 'unknown';
  shape?: unknown;
  decision?: unknown;
  eligibilityReport?: EligibilityReport;
  status?: number;
  url?: string;
}
export class OxygenProbe {
  private token = '';
  private expiresAt = 0;
  private reference = '';
  private phone = '';
  private newUserToken = '';
  private createLocked = false;
  private busy = false;
  private retryAvailable = false;
  private checkpointFailed = false;
  private customerPath: 'new' | 'existing' | 'unknown' = 'unknown';
  constructor(
    private config: ProbeConfig,
    private fetcher: typeof fetch = fetch
  ) {
    const expected = {
      dev: 'https://api.theoxygen.com/services/partners',
      staging: 'https://staging-api.theoxygen.com/services/partners',
      production: 'https://api.oxygenx.africa/services/partners',
    }[config.environment];
    if (config.baseUrl !== expected)
      throw new Error('Unsupported environment pairing');
    this.createLocked = config.resumeRejectedCreate === true;
    this.retryAvailable = this.createLocked;
    if (config.resumeState !== undefined) {
      const saved = oxygenProbeResumeSchema.parse(config.resumeState);
      this.reference = saved.reference;
      this.phone = saved.phone;
      this.newUserToken = saved.newUserToken;
      this.token = saved.token;
      this.expiresAt = saved.expiresAt;
      this.customerPath = saved.customerPath;
      this.createLocked = true;
      this.retryAvailable = false;
    }
    if (config.checkpoint !== undefined) {
      Object.assign(this, oxygenProbeCheckpointSchema.parse(config.checkpoint));
    }
  }
  getCheckpointState(): ProbeCheckpoint {
    const {
      reference,
      phone,
      newUserToken,
      customerPath,
      createLocked,
      retryAvailable,
    } = this;
    return {
      reference,
      phone,
      newUserToken,
      customerPath,
      createLocked,
      retryAvailable,
    };
  }
  private async persist() {
    try {
      await this.config.persistCheckpoint?.(this.getCheckpointState());
    } catch {
      this.checkpointFailed = true;
      throw new Error('checkpoint_error');
    }
  }
  getUiState() {
    return {
      requestCreated: Boolean(this.reference),
      creationLocked: this.createLocked,
      customerPath: this.customerPath,
    };
  }
  async run(action: string, input: unknown): Promise<ProbeResult> {
    if (this.checkpointFailed) return { code: 'checkpoint_error' };
    if (this.busy) return { code: 'busy' };
    if (!this.config.reference || !this.config.secret)
      return { code: 'credentials_required' };
    if (action !== 'login' && (!this.token || Date.now() >= this.expiresAt))
      return { code: 'login_required' };
    const body = record(input);
    if (action === 'prepare-retry') {
      if (!this.retryAvailable || this.reference)
        return { code: 'retry_unavailable' };
      if (body.acknowledge_duplicate_risk !== true)
        return { code: 'retry_acknowledgement_required' };
      this.createLocked = false;
      this.retryAvailable = false;
      this.busy = true;
      try {
        await this.persist();
        return { code: 'retry_ready' };
      } catch {
        return { code: 'checkpoint_error' };
      } finally {
        this.busy = false;
      }
    }
    let payload: Record<string, unknown>;
    let path: string;
    if (action === 'login') {
      path = '/v1/partner/login';
      payload = {
        reference: this.config.reference,
        secret: this.config.secret,
      };
    } else if (action === 'banks') {
      path = '/v1/eligibility/banks';
      payload = {};
    } else if (action === 'name-enquiry') {
      const parsed = oxygenProbeNameEnquirySchema.safeParse(input);
      if (!parsed.success) return { code: 'invalid_input' };
      path = '/v1/partner-loans/name-enquiry';
      payload = { ...parsed.data, type: 'EXTERNAL' };
    } else if (action === 'create') {
      if (this.createLocked) return { code: 'create_locked' };
      const parsed = oxygenProbeCustomerSchema.safeParse(input);
      if (!parsed.success) return { code: 'invalid_input' };
      path = '/v1/loan-request/create';
      payload = { ...parsed.data, partner_reference: this.config.reference };
      this.phone = parsed.data.customer_personal_details.phone_number;
      // No duplicate create, including after timeout/non-2xx or malformed response.
      this.createLocked = true;
      this.retryAvailable = false;
    } else {
      if (!this.reference) return { code: 'request_required' };
      payload = {
        loan_request_reference: this.reference,
        partner_reference: this.config.reference,
      };
      switch (action) {
        case 'validate-existing':
        case 'validate-new': {
          const parsed = oxygenProbeOtpSchema.safeParse(body);
          if (!parsed.success) return { code: 'invalid_input' };
          path =
            action === 'validate-new'
              ? '/v1/loan-request/validate/new/user'
              : '/v1/loan-request/validate/existing/user';
          payload = {
            ...payload,
            phone_number: this.phone,
            otp: parsed.data.otp,
          };
          if (action === 'validate-new') {
            const token = parsed.data.token || this.newUserToken;
            if (!token) return { code: 'new_user_token_required' };
            payload.token = token;
            this.newUserToken = token;
          }
          break;
        }
        case 'resend-otp':
          if (this.customerPath === 'unknown')
            return { code: 'customer_path_unknown' };
          path = `/v1/loan-request/retrigger/otp/${body.existingCustomerTest === true ? 'existing' : this.customerPath}/user`;
          break;
        case 'selfie':
          path = '/v1/loan-request/validate/selfie';
          break;
        case 'kyc':
          path = '/v1/loan-request/validate/kyc/status';
          break;
        case 'eligibility':
          path = '/v1/loan-request/get';
          break;
        default:
          return { code: 'unsupported_action' };
      }
    }
    this.busy = true;
    const startedAt = Date.now();
    try {
      if (action === 'create' || action === 'validate-new')
        await this.persist();
      const response = await this.fetcher(this.config.baseUrl + path, {
        method: action === 'banks' ? 'GET' : 'POST',
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(30000),
        headers: {
          'Content-Type': 'application/json',
          ...(action === 'login'
            ? {}
            : { Authorization: `Bearer ${this.token}` }),
        },
        body: action === 'banks' ? undefined : JSON.stringify(payload),
      });
      const raw = await response.text();
      if (raw.length > 262144)
        return { code: 'response_too_large', status: response.status };
      let data: unknown;
      try {
        data = JSON.parse(raw);
      } catch {
        return { code: 'invalid_response', status: response.status };
      }
      if (
        action === 'create' &&
        response.status === 400 &&
        typeof record(data).message === 'string' &&
        !record(data).loan_request_reference
      )
        this.retryAvailable = true;
      const result: ProbeResult = {
        code: response.ok ? 'response_received' : 'provider_error',
        status: response.status,
        shape: shape(data),
        ...(!response.ok
          ? {
              diagnostic: safeProviderDiagnostic(data, payload, [
                this.config.reference,
                this.config.secret,
                this.token,
                this.newUserToken,
              ]),
            }
          : {}),
      };
      if (action === 'login') {
        this.token = '';
        this.expiresAt = 0;
        const parsed = oxygenLoginResponseSchema.safeParse(data);
        if (response.ok && parsed.success) {
          this.token = parsed.data.token;
          this.expiresAt = startedAt + parsed.data.expires_in * 1000 - 5000;
          result.code = 'authenticated';
        }
      }
      if (action === 'banks' && response.ok) {
        const banks = parseBanks(data);
        if (!banks)
          return { code: 'invalid_bank_response', status: response.status };
        result.banks = banks;
        result.code = 'banks_loaded';
      }
      if (action === 'name-enquiry' && response.ok) {
        const fields = record(data);
        if (
          fields.success === true &&
          fields.errorCode === 0 &&
          typeof fields.accountName === 'string' &&
          fields.accountName.trim().length > 0 &&
          fields.accountName.length <= 150
        ) {
          result.accountName = fields.accountName;
          result.code = 'account_name_resolved';
        } else result.code = 'account_name_unresolved';
      }
      if (action === 'create' && response.ok) {
        const fields = record(data);
        if (
          typeof fields.loan_request_reference === 'string' &&
          fields.loan_request_reference.length > 0 &&
          fields.loan_request_reference.length < 200
        ) {
          this.reference = fields.loan_request_reference;
          this.newUserToken =
            typeof fields.token === 'string' ? fields.token : '';
          result.code = 'request_created';
          result.customerPath =
            fields.message === 'OTP sent for validation'
              ? 'existing'
              : fields.message === 'Customer creation initiated'
                ? 'new'
                : 'unknown';
          this.customerPath = result.customerPath;
        } else result.code = 'unknown_create_response';
      }
      if (action === 'resend-otp' && response.ok)
        result.code =
          record(data).message === 'OTP retriggered for validation'
            ? 'otp_resend_accepted'
            : 'unknown_resend_response';
      if (action === 'eligibility') {
        result.decision =
          response.status === 200 || response.status === 400
            ? classifyOxygenEligibility(data)
            : { kind: 'unknown' };
        result.eligibilityReport = readEligibilityReport(
          data,
          response.status,
          this.reference,
          this.config.reference
        );
        if (result.eligibilityReport)
          result.code = 'eligibility_report_received';
      }
      if (action === 'selfie' && response.ok) {
        const url = record(data).url;
        if (typeof url === 'string') {
          try {
            const target = new URL(url);
            if (
              target.protocol === 'https:' &&
              !target.username &&
              !target.password
            ) {
              result.url = target.href;
              result.code = 'selfie_link_ready';
            }
          } catch {
            /* No untrusted URL is opened. */
          }
        }
      }
      Object.assign(result, classifyProbeRecovery(action, response.ok, data));
      if (action === 'create') await this.persist();
      return result;
    } catch {
      if (this.checkpointFailed) return { code: 'checkpoint_error' };
      return {
        code:
          action === 'create' ||
          action.startsWith('validate') ||
          action === 'selfie' ||
          action === 'resend-otp'
            ? 'indeterminate'
            : 'network_error',
      };
    } finally {
      this.busy = false;
    }
  }
}
