import 'server-only';
import type { PilotInventoryBinding } from '@/schemas/merchant-image-variant-pilot';
import {
  PILOT_MAX_JOBS,
  parsePilotInventoryBinding,
} from '@/schemas/merchant-image-variant-pilot';

export function parsePilotInventory(
  value: unknown
):
  | { ok: true; bindings: PilotInventoryBinding[] }
  | { ok: false; issues: string[] } {
  if (!Array.isArray(value)) {
    return { issues: ['inventory: expected an array of bindings'], ok: false };
  }
  if (value.length > PILOT_MAX_JOBS) {
    return {
      issues: [`inventory: at most ${PILOT_MAX_JOBS} bindings`],
      ok: false,
    };
  }
  const bindings: PilotInventoryBinding[] = [];
  const issues: string[] = [];
  const slots = new Set<string>();
  const assets = new Set<string>();
  value.forEach((entry, index) => {
    const parsed = parsePilotInventoryBinding(entry);
    if (!parsed.ok) {
      issues.push(`binding ${index}: ${parsed.issues.join('; ')}`);
      return;
    }
    const slotKey = `${parsed.binding.merchantId}/${parsed.binding.slotId}`;
    const assetKey = `${parsed.binding.merchantId}/${parsed.binding.assetId}`;
    if (slots.has(slotKey)) {
      issues.push(`binding ${index}: duplicate slot "${slotKey}"`);
      return;
    }
    if (assets.has(assetKey)) {
      issues.push(`binding ${index}: duplicate asset "${assetKey}"`);
      return;
    }
    slots.add(slotKey);
    assets.add(assetKey);
    bindings.push(parsed.binding);
  });
  if (issues.length > 0) {
    return { issues, ok: false };
  }
  return { bindings, ok: true };
}

export function findPilotBinding(
  bindings: readonly PilotInventoryBinding[],
  key: { merchantId: string; slotId: string; originalUrl: string }
): PilotInventoryBinding | null {
  return (
    bindings.find(
      (binding) =>
        binding.merchantId === key.merchantId &&
        binding.slotId === key.slotId &&
        binding.originalUrl === key.originalUrl
    ) ?? null
  );
}
