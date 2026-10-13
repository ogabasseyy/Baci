import type { SavingsScreenSource } from '@baci/shared/contracts';
import type { createPiggyvestProtectedOfferController } from '@baci/shared/lib';
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { PiggyvestProtectedOffer } from './PiggyvestProtectedOffer';

export type PiggyvestProtectedOfferBindingInput = ReturnType<
  typeof createPiggyvestProtectedOfferController
>;
const emptySubscribe = () => () => undefined;
const emptySnapshot = () => 0;

export function PiggyvestProtectedOfferBinding({
  source,
  binding: supplied,
}: {
  source: SavingsScreenSource | null;
  binding: PiggyvestProtectedOfferBindingInput | null;
}) {
  const colors = Colors[useColorScheme() ?? 'light'];
  const binding =
    supplied &&
    (
      ['subscribe', 'getSnapshot', 'read', 'load', 'setViewGuard'] as const
    ).every((method) => typeof supplied[method] === 'function')
      ? supplied
      : null;
  const sourceKey = JSON.stringify(source);
  const lifetime = useRef({ sourceKey, binding, active: true });
  if (
    lifetime.current.sourceKey !== sourceKey ||
    lifetime.current.binding !== binding
  )
    lifetime.current = { sourceKey, binding, active: true };
  const lease = lifetime.current;
  binding?.setViewGuard(() => lifetime.current === lease && lease.active);
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
  let view: ReturnType<PiggyvestProtectedOfferBindingInput['read']> = null;
  try {
    view = binding?.read(source) ?? null;
  } catch {
    view = null;
  }
  if (!binding || !view || source?.status !== 'ready')
    return (
      <Text style={{ color: colors.text }}>Protected offer unavailable.</Text>
    );
  return (
    <View>
      {view.observation && !view.busy ? (
        <>
          <Text style={{ color: colors.text }}>
            {source.policy.device.productName} —{' '}
            {source.policy.device.variant ?? 'No variant'} —{' '}
            {source.policy.device.condition}
          </Text>
          <PiggyvestProtectedOffer observation={view.observation} />
        </>
      ) : (
        <Text accessibilityLiveRegion="polite" style={{ color: colors.text }}>
          {view.busy
            ? 'Checking protected offer…'
            : 'Protected offer unavailable.'}
        </Text>
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Refresh protected offer"
        disabled={view.busy}
        accessibilityState={{ disabled: view.busy, busy: view.busy }}
        onPress={() => {
          if (
            lifetime.current !== lease ||
            !lease.active ||
            !binding.read(source)
          )
            return;
          void binding.load().catch(() => undefined);
        }}
      >
        <Text style={{ color: colors.primary }}>Refresh protected offer</Text>
      </Pressable>
    </View>
  );
}
