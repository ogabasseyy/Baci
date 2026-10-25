import {
  canAssessImeiNetworkUnlock,
  getImeiBlacklistState,
} from '@baci/shared/imei';
import {
  matchesPetrockModelScope,
  normalizePetrockDeviceModel,
  type PetrockModelScope,
} from './petrock-device-model';
import { normalizePetrockRemediationCarrier } from './petrock-remediation-product-parser';

interface EligibilityResult {
  blacklistStatus?: string;
  carrier?: string;
  device?: string;
  financeStatus?: string;
  generation?: string;
  simLock?: string;
}

interface EligibilityProduct {
  carrier: string;
  id: string;
  isActive?: boolean;
  manualDisabled: boolean;
  modelScope: PetrockModelScope;
  statusSegment: string;
}

export type PetrockEligibilityCheckKind =
  | 'carrier_detection'
  | 'blacklist'
  | 'carrier_status';

function normalized(value: string | undefined) {
  return value?.trim().toLowerCase() ?? '';
}

function simLockState(value: string | undefined) {
  const status = normalized(value);
  if (!status || status === 'unknown') return 'unknown';
  if (/unlocked|not locked/.test(status)) return 'unlocked';
  return /locked/.test(status) ? 'locked' : 'unknown';
}

function statusSegment(value: string | undefined) {
  const status = normalized(value);
  if (!status || status === 'unknown') return null;
  // Negative evidence wins over positive words, including contradictory reports.
  if (
    /blacklist|lost|stolen|blocked|\bunpaid\b|\bineligible\b|\bnot\s+(?:eligible|paid|clear|clean)\b/.test(
      status
    )
  )
    return 'risk';
  if (status === 'past due') return 'past_due';
  if (/^account[- ]?locked$/.test(status)) return 'account_locked';
  if (/^wait\s*30(?:\s*days)?$/.test(status)) return 'wait_30_days';
  if (status === 'not active') return 'not_active';
  const positive = new Set([
    'clean',
    'eligible',
    'paid',
    'clear',
    'paid off',
    'fully paid',
    'paid in full',
  ]);
  return status.split(/\s*[/,;&]\s*/).every((part) => positive.has(part))
    ? 'clean'
    : null;
}

export function getPetrockEligibilityRequiredChecks(
  result: EligibilityResult
): PetrockEligibilityCheckKind[] {
  const checks: PetrockEligibilityCheckKind[] = [];
  if (
    !normalizePetrockRemediationCarrier(result.carrier ?? '') ||
    simLockState(result.simLock) === 'unknown'
  ) {
    checks.push('carrier_detection');
  }
  if (getImeiBlacklistState(result.blacklistStatus) === 'unknown') {
    checks.push('blacklist');
  }
  if (!statusSegment(result.financeStatus)) checks.push('carrier_status');
  return checks;
}

export function evaluatePetrockRemediationEligibility({
  products,
  result,
}: {
  products: readonly EligibilityProduct[];
  result: EligibilityResult;
}) {
  const carrier = normalizePetrockRemediationCarrier(result.carrier ?? '');
  const blacklist = getImeiBlacklistState(result.blacklistStatus);
  const finance = statusSegment(result.financeStatus);
  const checks = getPetrockEligibilityRequiredChecks(result);
  if (blacklist === 'risk') {
    return { kind: 'suppressed' as const, reason: 'blacklist_risk' as const };
  }
  if (!canAssessImeiNetworkUnlock(result)) {
    return {
      kind: 'suppressed' as const,
      reason:
        blacklist === 'unknown'
          ? ('blacklist_unknown' as const)
          : ('not_carrier_locked' as const),
    };
  }
  if (finance === 'risk') {
    return {
      kind: 'suppressed' as const,
      reason: 'carrier_status_risk' as const,
    };
  }
  if (checks.length > 0) {
    return { checks, kind: 'checks_required' as const };
  }

  if (simLockState(result.simLock) !== 'locked') {
    return {
      kind: 'suppressed' as const,
      reason: 'not_carrier_locked' as const,
    };
  }

  const model = normalizePetrockDeviceModel(
    result.device ?? '',
    result.generation
  );
  const productIds = products
    .filter(
      (product) =>
        product.carrier === carrier &&
        product.statusSegment === finance &&
        product.isActive !== false &&
        !product.manualDisabled &&
        matchesPetrockModelScope(model, product.modelScope)
    )
    .map((product) => product.id);
  return productIds.length > 0
    ? { kind: 'eligible' as const, productIds }
    : {
        kind: 'suppressed' as const,
        reason: 'no_matching_product' as const,
      };
}
