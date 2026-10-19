/**
 * Baci-owned approval proof (R0 spike, pure verification).
 *
 * No Baci-verifiable operation-specific approval receipt has been
 * demonstrated (see the R0 evidence doc), so Baci issues and verifies its
 * own one-time, effect-bound execution proof before any sensitive write.
 * Money-moving commands stay disabled until the proof gate passes end to
 * end.
 *
 * Verification rules:
 * - exact match: execution payload must hash to the approved effect digest,
 *   including resource version;
 * - one-time use: the nonce is consumed atomically with the business
 *   transaction (the DB enforces this; this module models the check);
 * - expiry: expired or drifted approvals require a new preview;
 * - authority: the approver must still hold permission at execution time.
 */

import { createHash } from 'node:crypto';
import { CONNECTOR_POLICY_VERSION } from '@/lib/connector/authorize';
import {
  type ConnectorErrorBody,
  connectorError,
} from '@/lib/connector/errors';

export type ApprovalProofJson =
  | string
  | number
  | boolean
  | null
  | ApprovalProofJson[]
  | { [key: string]: ApprovalProofJson };

export interface ApprovalIntent {
  approvalIntentId: string;
  actorUserId: string;
  connectorGrantId: string;
  operation: string;
  resourceId: string;
  resourceVersion: number;
  effectDigest: string;
  nonce: string;
  issuedAt: string;
  expiresAt: string;
  policyVersion: number;
}

export function canonicalizeEffect(effect: ApprovalProofJson): string {
  if (effect === null) return 'null';
  if (Array.isArray(effect)) {
    for (let index = 0; index < effect.length; index += 1) {
      if (!Object.hasOwn(effect, index)) {
        throw new Error('approval_effect_non_json_value');
      }
    }
    return `[${effect.map((item) => canonicalizeEffect(item)).join(',')}]`;
  }
  if (typeof effect === 'object') {
    const prototype = Object.getPrototypeOf(effect);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error('approval_effect_non_json_value');
    }
    const entries = Object.entries(effect)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(
        ([key, value]) => `${JSON.stringify(key)}:${canonicalizeEffect(value)}`
      );
    return `{${entries.join(',')}}`;
  }
  // Reject non-JSON runtime values instead of coercing them: silent
  // coercion could mask effect drift between preview and execution.
  if (
    typeof effect === 'undefined' ||
    typeof effect === 'function' ||
    typeof effect === 'symbol' ||
    typeof effect === 'bigint' ||
    (typeof effect === 'number' && !Number.isFinite(effect))
  ) {
    throw new Error('approval_effect_non_json_value');
  }
  return JSON.stringify(effect);
}

export function effectDigestOf(effect: ApprovalProofJson): string {
  return createHash('sha256').update(canonicalizeEffect(effect)).digest('hex');
}

export interface ApprovalExecution {
  operation: string;
  resourceId: string;
  resourceVersion: number;
  effect: ApprovalProofJson;
  actorUserId: string;
  connectorGrantId: string;
  /** True when the nonce was already consumed by any earlier execution. */
  nonceConsumed: boolean;
  /** True when the approver still holds the required permission. */
  approverAuthorized: boolean;
  now?: Date;
}

export type ApprovalVerificationResult =
  | { ok: true; nonce: string }
  | { ok: false; body: ConnectorErrorBody };

const APPROVAL_CLOCK_SKEW_MS = 5 * 60 * 1000;

export function verifyApprovalIntent(
  intent: ApprovalIntent,
  execution: ApprovalExecution
): ApprovalVerificationResult {
  const now = execution.now ?? new Date();
  const issuedMs = new Date(intent.issuedAt).getTime();
  const expiresMs = new Date(intent.expiresAt).getTime();
  if (Number.isNaN(issuedMs) || Number.isNaN(expiresMs)) {
    return {
      ok: false,
      body: connectorError('APPROVAL_EXPIRED', 'Approval has no valid window.'),
    };
  }
  if (expiresMs <= now.getTime()) {
    return {
      ok: false,
      body: connectorError(
        'APPROVAL_EXPIRED',
        'Approval expired. Request a new preview.'
      ),
    };
  }
  if (issuedMs > now.getTime() + APPROVAL_CLOCK_SKEW_MS) {
    return {
      ok: false,
      body: connectorError(
        'APPROVAL_EXPIRED',
        'Approval was issued in the future.'
      ),
    };
  }
  if (expiresMs <= issuedMs) {
    return {
      ok: false,
      body: connectorError('APPROVAL_EXPIRED', 'Approval window is invalid.'),
    };
  }
  if (
    execution.connectorGrantId !== intent.connectorGrantId ||
    execution.actorUserId !== intent.actorUserId
  ) {
    return {
      ok: false,
      body: connectorError(
        'FORBIDDEN_SCOPE',
        'Approval belongs to a different grant or approver.'
      ),
    };
  }
  if (!execution.approverAuthorized) {
    return {
      ok: false,
      body: connectorError(
        'ROLE_REMOVED',
        'Approver no longer holds the required permission.'
      ),
    };
  }
  if (execution.nonceConsumed) {
    return {
      ok: false,
      body: connectorError(
        'APPROVAL_ALREADY_USED',
        'Approval was already consumed. Request a new preview.'
      ),
    };
  }
  const matches =
    execution.operation === intent.operation &&
    execution.resourceId === intent.resourceId &&
    execution.resourceVersion === intent.resourceVersion &&
    effectDigestOf(execution.effect) === intent.effectDigest &&
    intent.policyVersion === CONNECTOR_POLICY_VERSION;
  if (!matches) {
    return {
      ok: false,
      body: connectorError(
        'APPROVAL_EXPIRED',
        'Approved effects changed. Request a new preview.'
      ),
    };
  }
  return { ok: true, nonce: intent.nonce };
}
