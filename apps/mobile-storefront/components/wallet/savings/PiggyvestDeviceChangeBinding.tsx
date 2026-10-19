import {
  type SavingsScreenSource,
  piggyvestDeviceChangeSchemas as schemas,
} from '@baci/shared/contracts';
import type { createPiggyvestDeviceChangeController } from '@baci/shared/lib';
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { PiggyvestDeviceChangeReview } from './PiggyvestDeviceChangeReview';

export type PiggyvestDeviceChangeBindingInput = ReturnType<
  typeof createPiggyvestDeviceChangeController
>;
export type PiggyvestDeviceChangeSelection = ReturnType<
  typeof schemas.selection.parse
>;
const subscribeEmpty = () => () => undefined;
const emptySnapshot = () => 0;

export function PiggyvestDeviceChangeBinding({
  source,
  binding: supplied,
  selection,
  disabled = false,
  isCompatible = () => true,
}: {
  source: SavingsScreenSource | null;
  binding: PiggyvestDeviceChangeBindingInput | null;
  selection?: PiggyvestDeviceChangeSelection | null;
  disabled?: boolean;
  isCompatible?: () => boolean;
}) {
  const colors = Colors[useColorScheme() ?? 'light'];
  const binding =
    supplied &&
    (
      [
        'read',
        'subscribe',
        'getSnapshot',
        'setViewGuard',
        'quote',
        'confirm',
        'recover',
      ] as const
    ).every((method) => typeof supplied[method] === 'function')
      ? supplied
      : null;
  const sourceKey = JSON.stringify(source);
  const lifetime = useRef({ binding, sourceKey, active: true });
  if (
    lifetime.current.binding !== binding ||
    lifetime.current.sourceKey !== sourceKey
  )
    lifetime.current = { binding, sourceKey, active: true };
  const lease = lifetime.current;
  binding?.setViewGuard(
    () => lifetime.current === lease && lease.active && isCompatible()
  );
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
  let view: ReturnType<PiggyvestDeviceChangeBindingInput['read']> = null;
  try {
    view = binding?.read(source) ?? null;
  } catch {
    view = null;
  }
  if (!view || !binding || source?.status !== 'ready')
    return (
      <Text style={{ color: colors.text }}>Device change unavailable.</Text>
    );
  if (view.status === 'review')
    return (
      <PiggyvestDeviceChangeReview
        key={JSON.stringify([source, view.command])}
        published={view.published}
        command={view.command}
        contextKey={sourceKey}
        disabled={disabled}
        onConfirm={async (command) => {
          if (
            disabled ||
            !isCompatible() ||
            binding.read(source)?.status !== 'review'
          )
            throw new Error('Device change unavailable');
          return await binding.confirm(command);
        }}
      />
    );
  if (!('recovering' in view)) {
    const parsed = schemas.selection.safeParse(selection);
    const unavailable =
      disabled ||
      view.status === 'loading_quote' ||
      !parsed.success ||
      parsed.data.goalId !== source.goalId;
    return (
      <View>
        <Text style={{ color: colors.text }}>
          Request the server quote for your exact replacement device. Wallet and
          balances are not moved.
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Review device change"
          disabled={unavailable}
          accessibilityState={{
            disabled: unavailable,
            busy: view.status === 'loading_quote',
          }}
          onPress={() => {
            if (!unavailable && parsed.success && isCompatible())
              void binding.quote(parsed.data).catch(() => undefined);
          }}
        >
          <Text style={{ color: colors.primary }}>Review device change</Text>
        </Pressable>
      </View>
    );
  }
  return (
    <View>
      <Text accessibilityLiveRegion="polite" style={{ color: colors.text }}>
        {!view.recovering && view.historical
          ? 'Historical device change only. Load a fresh authenticated plan before any further action.'
          : 'Device change requires reconciliation. Do not resubmit or create a new operation.'}
      </Text>
      <Text style={{ color: colors.text }}>
        No provider dispatch. A historical result is not current funding
        eligibility or a balance update.
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Refresh device change status"
        disabled={view.recovering || view.status === 'pending'}
        accessibilityState={{
          disabled: view.recovering || view.status === 'pending',
          busy: view.recovering,
        }}
        onPress={() => {
          void binding.recover().catch(() => undefined);
        }}
      >
        <Text style={{ color: colors.primary }}>
          Refresh device change status
        </Text>
      </Pressable>
    </View>
  );
}
