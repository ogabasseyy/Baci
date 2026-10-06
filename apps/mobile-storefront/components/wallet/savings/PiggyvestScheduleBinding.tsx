import type { SavingsScreenSource } from '@baci/shared/contracts';
import type { createPiggyvestScheduleController } from '@baci/shared/lib';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';

export type PiggyvestScheduleBindingInput = ReturnType<
  typeof createPiggyvestScheduleController
>;
const subscribeEmpty = () => () => undefined;
const emptySnapshot = () => 0;

export function PiggyvestScheduleBinding({
  source,
  binding: suppliedBinding,
  disabled = false,
  isCompatible = () => true,
}: {
  source: SavingsScreenSource | null;
  binding: PiggyvestScheduleBindingInput | null;
  disabled?: boolean;
  isCompatible?: () => boolean;
}) {
  const binding =
    suppliedBinding &&
    (
      [
        'setViewGuard',
        'setCompatibilityGuard',
        'subscribe',
        'getSnapshot',
        'read',
        'refresh',
        'pause',
        'requestResume',
      ] as const
    ).every((method) => typeof suppliedBinding[method] === 'function')
      ? suppliedBinding
      : null;
  const colors = Colors[useColorScheme() ?? 'light'];
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
    binding?.subscribe ?? subscribeEmpty,
    binding?.getSnapshot ?? emptySnapshot,
    emptySnapshot
  );
  const [accepted, setAccepted] = useState<{
    lease: typeof lease;
    version: number;
  } | null>(null);
  let view: ReturnType<PiggyvestScheduleBindingInput['read']> = null;
  try {
    view = binding?.read(source) ?? null;
  } catch {
    view = null;
  }
  if (!binding || !view)
    return (
      <Text style={{ color: colors.text }}>Schedule review unavailable.</Text>
    );
  const checked =
    accepted?.lease === lease &&
    accepted.version === view.snapshot?.state.version;
  const blocked = disabled || view.busy;
  async function perform(action: 'refresh' | 'pause' | 'resume') {
    if (
      !binding ||
      disabled ||
      current.current !== lease ||
      !lease.active ||
      !binding.read(source) ||
      isCompatible() !== true
    )
      return;
    setAccepted(null);
    try {
      if (action === 'resume')
        await binding.requestResume(checked, view?.snapshot?.state.version);
      else await binding[action]();
    } catch {
      return;
    }
  }
  return (
    <View accessibilityLabel="Schedule proposal review">
      <Text accessibilityRole="header" style={{ color: colors.text }}>
        Schedule proposal review
      </Text>
      <Text style={{ color: colors.text }}>
        No automatic collection is enabled. A saved proposal is not debit
        permission. Existing Paystack collection is unchanged.
      </Text>
      <Text style={{ color: colors.text }}>
        Cadence and collection-owner handover are unavailable.
      </Text>
      <Text accessibilityLiveRegion="polite" style={{ color: colors.text }}>
        {view.busy
          ? 'Checking schedule proposal…'
          : view.status === 'uncertain'
            ? 'Outcome unconfirmed. Recover the same operation; do not resubmit.'
            : view.status !== 'ready'
              ? 'Schedule review unavailable. Refresh to check.'
              : `Last recorded proposal: ${view.snapshot?.state.status}. Not an active collection schedule.`}
      </Text>
      {view.operationId && (
        <Text style={{ color: colors.text }}>
          Recovery operation: {view.operationId}
        </Text>
      )}
      {view.historical && (
        <Text style={{ color: colors.text }}>
          Historical receipt: {view.historical.receipt.operationId} —{' '}
          {view.historical.receipt.state.status}. History only, not current
          authority.
        </Text>
      )}
      <Text style={{ color: colors.text }}>{view.terms.text}</Text>
      <Text style={{ color: colors.text }}>
        Terms revision: {view.snapshot?.revisionId ?? 'unavailable'}; version:{' '}
        {view.terms.version}
      </Text>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{
          checked,
          disabled: blocked || !view.canRequestResume,
        }}
        disabled={blocked || !view.canRequestResume}
        onPress={() =>
          setAccepted(
            !checked && view.snapshot
              ? { lease, version: view.snapshot.state.version }
              : null
          )
        }
      >
        <Text style={{ color: colors.text }}>
          I request a saved resume proposal under these terms, not an automatic
          debit.
        </Text>
      </Pressable>
      {(['resume', 'pause', 'refresh'] as const).map((action) => {
        const label =
          action === 'resume'
            ? 'Save resume proposal'
            : action === 'pause'
              ? 'Pause schedule proposal'
              : 'Refresh schedule review';
        const unavailable =
          blocked ||
          (action === 'resume'
            ? !checked || !view.canRequestResume
            : action === 'pause' && view.status !== 'ready');
        return (
          <Pressable
            key={action}
            accessibilityRole="button"
            accessibilityLabel={label}
            disabled={unavailable}
            accessibilityState={{ disabled: unavailable, busy: view.busy }}
            onPress={() => void perform(action)}
          >
            <Text style={{ color: colors.primary }}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
