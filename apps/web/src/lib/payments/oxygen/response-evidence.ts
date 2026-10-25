import 'server-only';
import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from 'node:crypto';
import type { OxygenProviderOperation } from './provider';
import type { OxygenRuntimeRpc } from './runtime-service';

export interface OxygenObservedResponse {
  operation: OxygenProviderOperation;
  httpStatus: number;
  requestId: string | null;
  capture: 'parsed' | 'non_json' | 'oversized' | 'unavailable';
  durationMs: number;
  body?: unknown;
  failure?: {
    providerMessage: string | null;
    providerCode: string | null;
    details: string[];
  };
}
const fields = [
  'loan_reference',
  'status',
  'product_amount',
  'equity_amount',
  'loan_amount',
  'loan_tenure',
  'equity_percentage',
  'total_charges',
  'total_upfront_payment',
  'repayment_setup_link',
  'split_payment_link',
  'url',
] as const;
const containers = ['', 'data', 'result', 'booking', 'loan'] as const;
const record = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
export function projectOxygenResponse(
  response: OxygenObservedResponse,
  hosts: ReadonlySet<string>
) {
  const shape: Record<string, string> = {};
  const terms: Record<string, string | number> = {};
  const links: Record<string, string> = {};
  const rejectedLinks: Record<
    string,
    { reason: string; host?: string; length: number }
  > = {};
  const root = record(response.body);
  for (const container of containers) {
    const object = container ? record(root?.[container]) : root;
    if (!object) continue;
    for (const field of fields) {
      if (!Object.hasOwn(object, field)) continue;
      const value = object[field];
      const path = container ? `${container}.${field}` : field;
      shape[path] =
        value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
      if (field.endsWith('_link') || field === 'url') {
        if (typeof value !== 'string') continue;
        try {
          const url = new URL(value);
          const reason =
            url.protocol !== 'https:'
              ? 'scheme'
              : url.username || url.password
                ? 'credentials'
                : url.port
                  ? 'port'
                  : !hosts.has(url.hostname)
                    ? 'host'
                    : value.length > 4096
                      ? 'length'
                      : Object.keys(links).length >= 2
                        ? 'limit'
                        : null;
          if (reason)
            rejectedLinks[path] = {
              reason,
              host: url.hostname.slice(0, 253),
              length: value.length,
            };
          else links[path] = url.href;
        } catch {
          rejectedLinks[path] = { reason: 'invalid', length: value.length };
        }
      } else if (field === 'loan_reference') {
        if (
          typeof value === 'string' &&
          /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value)
        )
          terms[path] = value;
      } else if (field === 'status') {
        if (
          typeof value === 'string' &&
          ['BOOKED', 'APPROVED', 'ACTIVATED', 'CANCELLED'].includes(value)
        )
          terms[path] = value;
      } else if (
        typeof value === 'number' &&
        Number.isFinite(value) &&
        Math.abs(value) <= Number.MAX_SAFE_INTEGER
      )
        terms[path] = value;
    }
  }
  const verification: Record<string, string> = {};
  for (const field of [
    'phone_status',
    'bvn_status',
    'nin_status',
    'bank_status',
    'selfie_status',
    'address_status',
  ]) {
    const value = root?.[field];
    if (
      typeof value === 'string' &&
      ['DONE', 'NOT_DONE', 'PROCESSING', 'UNKNOWN'].includes(value)
    )
      verification[field] = value;
  }
  // Full bodies, arbitrary strings/keys, tokens, identity fields and request inputs never enter this projection.
  // Failure text is redacted against request values and credentials before observation.
  const payload = {
    version: 1,
    operation: response.operation,
    httpStatus: response.httpStatus,
    requestId:
      response.requestId &&
      /^(?:[a-f0-9]{32}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/i.test(
        response.requestId
      )
        ? response.requestId
        : null,
    capture: response.capture,
    durationMs: Math.min(300000, Math.max(0, response.durationMs)),
    shape,
    terms,
    links,
    rejectedLinks,
    ...(Object.keys(verification).length ? { verification } : {}),
    ...(response.failure
      ? {
          failure: {
            providerMessage:
              response.failure.providerMessage?.slice(0, 1000) ?? null,
            providerCode: response.failure.providerCode?.slice(0, 32) ?? null,
            details: response.failure.details
              .slice(0, 6)
              .map((text) => text.slice(0, 384)),
          },
        }
      : {}),
  };
  if (Buffer.byteLength(JSON.stringify(payload)) > 24000)
    throw new Error('Response evidence unavailable');
  return payload;
}
function keyBytes(secret: string) {
  if (!/^[a-f0-9]{64}$/i.test(secret))
    throw new Error('Response evidence unavailable');
  return Buffer.from(
    hkdfSync(
      'sha256',
      Buffer.from(secret, 'hex'),
      Buffer.alloc(0),
      'oxygen-response-evidence:v1',
      32
    )
  );
}
const aad = (workflowId: string, commandId: string, sequence: number) =>
  Buffer.from(
    JSON.stringify([
      'oxygen-response-evidence:v1',
      workflowId,
      commandId,
      sequence,
    ])
  );
export function encryptOxygenResponse(
  payload: ReturnType<typeof projectOxygenResponse>,
  secret: string,
  workflowId: string,
  commandId: string,
  sequence: number
) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyBytes(secret), iv);
  cipher.setAAD(aad(workflowId, commandId, sequence));
  const bytes = Buffer.concat([
    cipher.update(JSON.stringify(payload), 'utf8'),
    cipher.final(),
  ]);
  return [
    'v1',
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    bytes.toString('base64url'),
  ].join('.');
}
export function decryptOxygenResponse(
  ciphertext: string,
  secret: string,
  workflowId: string,
  commandId: string,
  sequence: number
): unknown {
  const [version, iv, tag, body, extra] = ciphertext.split('.');
  if (
    version !== 'v1' ||
    !iv ||
    !tag ||
    !body ||
    extra ||
    Buffer.from(iv, 'base64url').length !== 12 ||
    Buffer.from(tag, 'base64url').length !== 16
  )
    throw new Error('Response evidence unavailable');
  const decipher = createDecipheriv(
    'aes-256-gcm',
    keyBytes(secret),
    Buffer.from(iv, 'base64url')
  );
  decipher.setAAD(aad(workflowId, commandId, sequence));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return JSON.parse(
    Buffer.concat([
      decipher.update(Buffer.from(body, 'base64url')),
      decipher.final(),
    ]).toString('utf8')
  ) as unknown;
}
export function createOxygenResponseRecorder(
  worker: OxygenRuntimeRpc,
  workflowId: string,
  commandId: string,
  secret: string,
  hosts: ReadonlySet<string>
) {
  keyBytes(secret); // Validate before the provider request, not after it has changed state.
  let sequence = 0;
  return async (response: OxygenObservedResponse) => {
    ++sequence;
    const ciphertext = encryptOxygenResponse(
      projectOxygenResponse(response, hosts),
      secret,
      workflowId,
      commandId,
      sequence
    );
    const result = await worker.rpc('oxygen_response_evidence', {
      p_operation: 'record',
      p_command_id: commandId,
      p_sequence: sequence,
      p_ciphertext: ciphertext,
    });
    if (result.error) throw new Error('Response evidence unavailable');
  };
}

/** Worker-only recovery inspection; never changes approval/payment state. */
export async function readOxygenResponseEvidence(
  worker: OxygenRuntimeRpc,
  workflowId: string,
  commandId: string,
  secret: string
) {
  const result = await worker.rpc('oxygen_response_evidence', {
    p_operation: 'read',
    p_command_id: commandId,
  });
  if (result.error || !Array.isArray(result.data))
    throw new Error('Response evidence unavailable');
  return result.data.map((row: unknown) => {
    const value = record(row);
    if (
      !value ||
      typeof value.sequence !== 'number' ||
      typeof value.ciphertext !== 'string'
    )
      throw new Error('Response evidence unavailable');
    return decryptOxygenResponse(
      value.ciphertext,
      secret,
      workflowId,
      commandId,
      value.sequence
    );
  });
}
