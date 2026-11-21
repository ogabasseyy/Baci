import {
  type OxygenTransientFile,
  oxygenAccountNameSchema,
  oxygenActionNotDispatchedCode,
  oxygenApprovalCodeResponseSchema,
  oxygenBankListSchema,
  oxygenBankRequestSchema,
  oxygenDraftResponseSchema,
  oxygenDraftWriteSchema,
  oxygenEligibilityProgressHeader,
  oxygenMobileCapabilitiesSchema,
  oxygenResidentialContextSchema,
  oxygenRuntimeSnapshotSchema,
  oxygenRuntimeSubmissionSchema,
  oxygenRuntimeUnavailableCode,
  oxygenWorkflowRequestSchema,
  oxygenWorkflowSnapshotSchema,
  validateOxygenFile,
} from '@baci/shared/oxygen';
import { z } from 'zod';
import {
  type OxygenCapabilityPins,
  oxygenCapabilityPinsMatch,
} from '@/lib/oxygen-staging-profile';
import { assertOxygenActionFile } from './action-file';
import { OxygenClientError } from './errors';
import { prepareOxygenMultipart } from './multipart';

export type OxygenClientProfile = OxygenCapabilityPins & {
  apiOrigin: string;
};
export interface OxygenSession {
  access_token: string;
  user: { id: string };
}
const idSchema = z.uuid();
const recovery = z
  .object({
    workflowId: z.uuid(),
    version: z.number().int().nonnegative(),
    idempotencyKey: z.uuid(),
  })
  .strict();
const selfie = z
  .object({ confirmed: z.boolean(), checkedAt: z.iso.datetime() })
  .strict();
const created = z
  .object({ workflow: oxygenWorkflowSnapshotSchema })
  .passthrough();
export function createOxygenClient(options: {
  profile: OxygenClientProfile;
  getSession: () => Promise<OxygenSession | null>;
  fetch: typeof fetch;
  expectedUserId?: string;
}) {
  const { profile } = options;
  const environment = profile.environment ?? 'staging';
  const origin = new URL(profile.apiOrigin);
  if (origin.origin !== profile.apiOrigin || origin.username || origin.password)
    throw new OxygenClientError('scope');
  async function request<T>(
    path: string,
    schema: z.ZodType<T>,
    method = 'GET',
    body?: unknown,
    file?: OxygenTransientFile
  ): Promise<T> {
    let session: OxygenSession | null;
    try {
      session = await options.getSession();
    } catch (error) {
      if (error instanceof OxygenClientError) throw error;
      throw new OxygenClientError('auth', undefined, 'not_dispatched');
    }
    if (
      !session?.access_token ||
      !idSchema.safeParse(session.user.id).success ||
      (options.expectedUserId && session.user.id !== options.expectedUserId)
    )
      throw new OxygenClientError('auth', undefined, 'not_dispatched');
    const headers: Record<string, string> = {
      Authorization: `Bearer ${session.access_token}`,
      Accept: 'application/json',
      'Cache-Control': 'no-store',
    };
    if (path === 'workflows/actions' || path.startsWith('workflows/actions?')) {
      headers['x-oxygen-eligibility-reason'] = '1';
      headers[oxygenEligibilityProgressHeader] = '1';
    }
    let payload: BodyInit | undefined;
    let multipart: ReturnType<typeof prepareOxygenMultipart> | undefined;
    try {
      if (file) {
        if (!validateOxygenFile(file.bytes, file.type, file.name))
          throw new OxygenClientError('invalid');
        multipart = prepareOxygenMultipart(body, file);
        payload = multipart.form;
      } else if (body !== undefined) {
        headers['Content-Type'] = 'application/json';
        payload = JSON.stringify(body);
      }
    } catch {
      throw new OxygenClientError('invalid', undefined, 'not_dispatched');
    }
    let response: Pick<
      Response,
      'redirected' | 'url' | 'ok' | 'status' | 'json'
    >;
    try {
      const fetch = multipart?.fetch ?? options.fetch;
      response = await fetch(
        `${profile.apiOrigin}/api/payments/oxygen/${path}`,
        {
          method,
          headers,
          body: payload,
          credentials: 'omit',
          redirect: 'error',
        }
      );
    } catch {
      throw new OxygenClientError('transport');
    } finally {
      multipart?.dispose?.();
    }
    if (
      response.redirected ||
      (response.url && new URL(response.url).origin !== profile.apiOrigin)
    )
      throw new OxygenClientError('scope');
    if (!response.ok) {
      const definitiveRejection =
        [409, 503].includes(response.status) &&
        method === 'POST' &&
        path === 'workflows/actions'
          ? z
              .union([
                z.object({ code: z.literal(oxygenRuntimeUnavailableCode) }),
                z.object({
                  code: z.enum([
                    'OXYGEN_ACTIVE_LOAN',
                    oxygenActionNotDispatchedCode,
                  ]),
                  dispatchState: z.literal('not_dispatched'),
                }),
              ])
              .safeParse(await response.json().catch(() => null)).success
          : false;
      throw new OxygenClientError(
        response.status === 401 ? 'auth' : 'http',
        response.status,
        definitiveRejection || [400, 401, 403, 429].includes(response.status)
          ? 'not_dispatched'
          : 'unknown'
      );
    }
    try {
      return schema.parse(await response.json());
    } catch {
      throw new OxygenClientError('invalid');
    }
  }
  const query = (path: string, id: string) =>
    `${path}?workflowId=${encodeURIComponent(idSchema.parse(id))}`;
  return {
    async capabilities() {
      const caps = await request(
        `mobile-capabilities?merchantSlug=${encodeURIComponent(profile.merchantSlug)}`,
        oxygenMobileCapabilitiesSchema
      );
      if (!oxygenCapabilityPinsMatch(profile, caps))
        throw new OxygenClientError('scope');
      return caps;
    },
    async createOrResume(
      orderId: string,
      channel: 'mobile' | 'web' | 'chat' = 'mobile'
    ) {
      const result = await request(
        'workflows',
        created,
        'POST',
        oxygenWorkflowRequestSchema.parse({ orderId, channel })
      );
      if (
        result.workflow.environment !== environment ||
        result.workflow.order_id !== orderId
      )
        throw new OxygenClientError('scope');
      return result.workflow;
    },
    async snapshot(workflowId: string) {
      const result = await request(
        query('workflows/actions', workflowId),
        oxygenRuntimeSnapshotSchema
      );
      if (
        result.environment !== environment ||
        result.workflowId !== workflowId
      )
        throw new OxygenClientError('scope');
      return result;
    },
    async action(
      submission: z.infer<typeof oxygenRuntimeSubmissionSchema>,
      file?: OxygenTransientFile
    ) {
      const parsed = oxygenRuntimeSubmissionSchema.parse(submission);
      assertOxygenActionFile(parsed.command, file);
      const result = await request(
        'workflows/actions',
        oxygenRuntimeSnapshotSchema,
        'POST',
        parsed,
        file
      );
      if (
        result.workflowId !== parsed.workflowId ||
        result.environment !== environment
      )
        throw new OxygenClientError('scope');
      return result;
    },
    draft: {
      read: (workflowId: string) =>
        request(query('draft', workflowId), oxygenDraftResponseSchema),
      write: (input: z.infer<typeof oxygenDraftWriteSchema>) =>
        request(
          'draft',
          z.object({ version: z.number().int().nonnegative() }).strict(),
          'PUT',
          oxygenDraftWriteSchema.parse(input)
        ),
    },
    residentialContext: (workflowId: string) =>
      request(
        query('residential-context', workflowId),
        oxygenResidentialContextSchema
      ),
    bankDetails: (input: z.infer<typeof oxygenBankRequestSchema>) => {
      const parsed = oxygenBankRequestSchema.parse(input);
      return parsed.action === 'banks'
        ? request('bank-details', oxygenBankListSchema, 'POST', parsed)
        : request('bank-details', oxygenAccountNameSchema, 'POST', parsed);
    },
    approvalWindow: (workflowId: string) =>
      request(
        query('approval-code', workflowId),
        oxygenApprovalCodeResponseSchema
      ),
    selfieStatus: (workflowId: string) =>
      request(query('workflows/selfie-status', workflowId), selfie),
    retirePhone: (input: z.infer<typeof recovery>) =>
      request(
        'workflows/phone-recovery',
        z.object({ retired: z.literal(true) }).strict(),
        'POST',
        recovery.parse(input)
      ),
    retireAddress: (
      input: z.infer<typeof recovery> & { bookingReference: string }
    ) =>
      request(
        'workflows/address-recovery',
        z.object({ retired: z.literal(true) }).strict(),
        'POST',
        recovery.extend({ bookingReference: z.uuid() }).parse(input)
      ),
  };
}
export type OxygenClient = ReturnType<typeof createOxygenClient>;
