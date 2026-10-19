import {
  piggyvestPurchaseSchemas,
  type SavingsScreenSource,
} from '@baci/shared/contracts';
import type { createPiggyvestPurchaseController } from '@baci/shared/lib';
import { formatPiggyvestPurchaseMoney as money } from '@baci/shared/lib';
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { z } from 'zod';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { PiggyvestPurchaseReview } from './PiggyvestPurchaseReview';

export type PiggyvestPurchaseBindingInput = ReturnType<
  typeof createPiggyvestPurchaseController
>;
export type PiggyvestPurchaseSelection = z.infer<
  typeof piggyvestPurchaseSchemas.selection
>;
const noSubscription = () => () => undefined;
const emptySnapshot = () => 0;

export function PiggyvestPurchaseBinding({
  source,
  binding,
  selection,
  disabled = false,
  isCompatible = () => true,
}: {
  source: SavingsScreenSource | null;
  binding: PiggyvestPurchaseBindingInput | null;
  selection?: PiggyvestPurchaseSelection | null;
  disabled?: boolean;
  isCompatible?: () => boolean;
}) {
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
  const observable =
    binding &&
    typeof binding.subscribe === 'function' &&
    typeof binding.getSnapshot === 'function' &&
    typeof binding.read === 'function'
      ? binding
      : null;
  useSyncExternalStore(
    observable?.subscribe ?? noSubscription,
    observable?.getSnapshot ?? emptySnapshot,
    emptySnapshot
  );
  let view: ReturnType<PiggyvestPurchaseBindingInput['read']> = null;
  try {
    view = observable?.read(source) ?? null;
  } catch {
    view = null;
  }
  if (!observable || !view || source?.status !== 'ready') {
    return <Text style={{ color: colors.text }}>Purchase is unavailable.</Text>;
  }
  if (view.status === 'review') {
    const device = source.policy.device;
    return (
      <PiggyvestPurchaseReview
        key={JSON.stringify([source, view.command])}
        contextKey={JSON.stringify(source)}
        device={`${device.productName} — ${device.variant ?? 'No variant'} — ${device.condition}`}
        quote={view.quote}
        command={view.command}
        disabled={disabled}
        onPrepare={async (command) => {
          if (
            disabled ||
            !isCompatible() ||
            observable.read(source)?.status !== 'review'
          )
            throw new Error('Purchase unavailable');
          return await observable.prepare(command);
        }}
      />
    );
  }
  if (
    view.status === 'selection' ||
    view.status === 'loading_quote' ||
    view.status === 'unavailable'
  ) {
    const parsed = piggyvestPurchaseSchemas.selection.safeParse(selection);
    const unavailable =
      disabled ||
      view.status === 'loading_quote' ||
      !parsed.success ||
      parsed.data.goalId !== source.goalId;
    return (
      <View>
        <Text style={{ color: colors.text }}>
          Request an exact pickup purchase quote. No purchase or provider
          payment occurs.
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Review purchase quote"
          disabled={unavailable}
          accessibilityState={{
            disabled: unavailable,
            busy: view.status === 'loading_quote',
          }}
          onPress={() => {
            if (!unavailable && parsed.success && isCompatible())
              void observable.quote(parsed.data).catch(() => undefined);
          }}
        >
          <Text style={{ color: colors.primary }}>Review purchase quote</Text>
        </Pressable>
      </View>
    );
  }
  if (!('recovering' in view))
    return <Text style={{ color: colors.text }}>Purchase is unavailable.</Text>;
  const current = !view.recovering ? view.recovery?.current : null;
  return (
    <View>
      <Text accessibilityLiveRegion="polite" style={{ color: colors.text }}>
        {current?.status === 'observed'
          ? 'Local purchase reservation retained.'
          : 'Purchase outcome requires reconciliation. Reservation may be retained.'}
      </Text>
      <Text style={{ color: colors.text }}>
        Not purchased or fulfilled. Provider dispatch unavailable. Do not
        resubmit or start a new operation.
      </Text>
      {view.receipt && (
        <Text style={{ color: colors.text }}>
          Original preparation only, not current balances: principal{' '}
          {money(view.receipt.principalKobo)}; paid interest{' '}
          {money(view.receipt.paidInterestKobo)}; quoted surplus{' '}
          {money(view.receipt.surplusKobo)}; other payment{' '}
          {money(view.receipt.otherPaymentKobo)}.
        </Text>
      )}
      {current?.status === 'observed' && (
        <Text style={{ color: colors.text }}>
          Internal ledger observation only: unreserved principal{' '}
          {money(current.balances.unreservedPrincipalKobo)}; unreserved paid
          interest {money(current.balances.unreservedPaidInterestKobo)}; pending
          interest {money(current.balances.pendingInterestKobo)}. No funds-use
          authority.
        </Text>
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Refresh purchase status"
        disabled={view.recovering || view.status === 'pending'}
        accessibilityState={{
          disabled: view.recovering || view.status === 'pending',
          busy: view.recovering,
        }}
        onPress={() => {
          void observable.recover().catch(() => undefined);
        }}
      >
        <Text style={{ color: colors.primary }}>Refresh purchase status</Text>
      </Pressable>
    </View>
  );
}
