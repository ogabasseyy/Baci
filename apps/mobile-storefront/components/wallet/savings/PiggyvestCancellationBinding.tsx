import type { SavingsScreenSource } from '@baci/shared/contracts';
import type { createPiggyvestCancellationController } from '@baci/shared/lib';
import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { PiggyvestCancellationReview } from './PiggyvestCancellationReview';

export type PiggyvestCancellationBindingInput = ReturnType<
  typeof createPiggyvestCancellationController
>;
export function PiggyvestCancellationBinding({
  source,
  binding,
  disabled = false,
  isCompatible = () => true,
}: {
  source: SavingsScreenSource | null;
  binding: PiggyvestCancellationBindingInput | null;
  disabled?: boolean;
  isCompatible?: () => boolean;
}) {
  const [, refresh] = useState(0);
  const scheme = useColorScheme();
  const colors = Colors[scheme ?? 'light'];
  const sourceKey = JSON.stringify(source);
  const lifetime = useRef({ binding, sourceKey, active: true });
  if (
    lifetime.current.binding !== binding ||
    lifetime.current.sourceKey !== sourceKey
  )
    lifetime.current = { binding, sourceKey, active: true };
  const lease = lifetime.current;
  if (binding && typeof binding.setViewGuard === 'function')
    binding.setViewGuard(
      () => lease.active && lifetime.current === lease && isCompatible()
    );
  useEffect(() => {
    lease.active = true;
    return () => {
      lease.active = false;
    };
  }, [lease]);
  let view: ReturnType<PiggyvestCancellationBindingInput['read']> = null;
  try {
    view = binding?.read(source) ?? null;
  } catch {
    view = null;
  }
  if (!view || !binding)
    return (
      <Text style={{ color: colors.text }}>Cancellation is unavailable.</Text>
    );
  if (view.status !== 'review')
    return (
      <View>
        <Text accessibilityLiveRegion="polite" style={{ color: colors.text }}>
          {!view.recovering && view.recovery?.status === 'prepared'
            ? 'Principal reservation retained. Not refunded; interest unresolved.'
            : !view.recovering && view.recovery?.status === 'absent'
              ? 'No matching operation observed. This does not authorize a retry.'
              : 'Cancellation requires recovery. Reservation may be retained. Do not resubmit.'}
        </Text>
        <Text style={{ color: colors.text }}>
          Provider dispatch unavailable. No new cancellation is authorized.
        </Text>
        {!view.recovering && view.recovery?.status === 'prepared' && (
          <View>
            <Text style={{ color: colors.text }}>
              Original disclosure — not current balances.
            </Text>
            <Text style={{ color: colors.text }}>
              Principal (kobo): {view.recovery.originalDisclosure.principalKobo}
            </Text>
            <Text style={{ color: colors.text }}>
              Paid interest (kobo):{' '}
              {view.recovery.originalDisclosure.paidInterestKobo}
            </Text>
            <Text style={{ color: colors.text }}>
              Pending interest (kobo):{' '}
              {view.recovery.originalDisclosure.pendingInterestKobo}
            </Text>
          </View>
        )}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Refresh cancellation status"
          disabled={view.recovering}
          accessibilityState={{
            disabled: view.recovering,
            busy: view.recovering,
          }}
          onPress={async () => {
            const pending = binding.recover();
            refresh((value) => value + 1);
            await pending.catch(() => undefined);
            refresh((value) => value + 1);
          }}
        >
          <Text style={{ color: colors.primary }}>
            Refresh cancellation status
          </Text>
        </Pressable>
      </View>
    );
  if (disabled)
    return (
      <Text style={{ color: colors.text }}>
        Cancellation review is unavailable while another operation requires
        reconciliation.
      </Text>
    );
  return (
    <PiggyvestCancellationReview
      sessionKey={view.sessionKey}
      goalId={view.goalId}
      operationId={view.operationId}
      quote={view.quote}
      contextKey={JSON.stringify(source)}
      onPrepare={async (command) => {
        if (
          disabled ||
          !isCompatible() ||
          binding.read(source)?.status !== 'review'
        )
          throw new Error('Cancellation unavailable');
        return await binding.prepare(command);
      }}
    />
  );
}
