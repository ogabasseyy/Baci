import type { SavingsScreenSource } from '@baci/shared/contracts';
import type { createPiggyvestDraftClosureController } from '@baci/shared/lib';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';

export type PiggyvestDraftClosureBindingInput = ReturnType<
  typeof createPiggyvestDraftClosureController
>;
const emptySubscribe = () => () => undefined;
const emptySnapshot = () => 0;
export function PiggyvestDraftClosureBinding({
  source,
  binding: supplied,
  disabled = false,
  isCompatible = () => true,
}: {
  source: SavingsScreenSource | null;
  binding: PiggyvestDraftClosureBindingInput | null;
  disabled?: boolean;
  isCompatible?: () => boolean;
}) {
  const colors = Colors[useColorScheme() ?? 'light'];
  const binding =
    supplied &&
    (
      [
        'setViewGuard',
        'setCompatibilityGuard',
        'subscribe',
        'getSnapshot',
        'read',
        'refresh',
        'close',
      ] as const
    ).every((method) => typeof supplied[method] === 'function')
      ? supplied
      : null;
  const sourceKey = JSON.stringify(source);
  const current = useRef({ binding, sourceKey, active: true });
  if (
    current.current.binding !== binding ||
    current.current.sourceKey !== sourceKey
  )
    current.current = { binding, sourceKey, active: true };
  const lease = current.current;
  binding?.setViewGuard(() => current.current === lease && lease.active);
  binding?.setCompatibilityGuard(isCompatible);
  useEffect(() => {
    lease.active = true;
    return () => {
      lease.active = false;
    };
  }, [lease]);
  useSyncExternalStore(
    binding?.subscribe ?? emptySubscribe,
    binding?.getSnapshot ?? emptySnapshot,
    emptySnapshot
  );
  const [consent, setConsent] = useState<{
    lease: typeof lease;
    version: number;
  } | null>(null);
  let view: ReturnType<PiggyvestDraftClosureBindingInput['read']> = null;
  try {
    view = binding?.read(source) ?? null;
  } catch {
    view = null;
  }
  if (!view || !binding)
    return (
      <Text style={{ color: colors.text }}>Plan closure unavailable.</Text>
    );
  const checked =
    consent?.lease === lease && consent.version === view.reviewVersion;
  async function perform(close: boolean) {
    try {
      if (
        !binding ||
        disabled ||
        current.current !== lease ||
        !lease.active ||
        (close && isCompatible() !== true)
      )
        return;
      if (!binding.read(source)) return;
      setConsent(null);
      if (close) {
        await binding.close(checked, view?.reviewVersion);
      } else await binding.refresh();
    } catch {
      return;
    }
  }
  return (
    <View accessibilityLabel="Close unfunded plan">
      <Text accessibilityRole="header" style={{ color: colors.text }}>
        Close unfunded plan
      </Text>
      <Text style={{ color: colors.text }}>
        Only a server-verified unfunded, unexposed draft can be closed. This
        does not issue a refund or delete a provider wallet.
      </Text>
      <Text accessibilityLiveRegion="polite" style={{ color: colors.text }}>
        {view.busy
          ? 'Checking plan closure…'
          : view.status === 'closed'
            ? 'Plan closed. No refund issued; no provider wallet deleted.'
            : view.status === 'uncertain'
              ? 'Closure outcome unconfirmed. Refresh status; do not resubmit.'
              : view.status === 'requires_reconciliation'
                ? 'Funding exposure requires reconciliation. Plan not closed or refunded.'
                : view.status === 'review'
                  ? 'Unfunded draft available for closure review.'
                  : 'Plan closure unavailable.'}
      </Text>
      {view.status === 'review' && (
        <>
          <Text style={{ color: colors.text }}>{view.terms.text}</Text>
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked, disabled: disabled || view.busy }}
            disabled={disabled || view.busy}
            onPress={() =>
              setConsent(
                !checked ? { lease, version: view.reviewVersion } : null
              )
            }
          >
            <Text style={{ color: colors.text }}>
              I confirm closing this unfunded draft under these terms.
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close plan"
            accessibilityState={{ disabled: disabled || view.busy || !checked }}
            disabled={disabled || view.busy || !checked}
            onPress={() => void perform(true)}
          >
            <Text style={{ color: colors.primary }}>Close plan</Text>
          </Pressable>
        </>
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Refresh plan closure"
        accessibilityState={{ disabled: view.busy }}
        disabled={view.busy}
        onPress={() => void perform(false)}
      >
        <Text style={{ color: colors.primary }}>Refresh plan closure</Text>
      </Pressable>
    </View>
  );
}
