import { piggyvestSavingsScreenSchema } from '@baci/shared/contracts';
import { ScrollView, Text, View } from 'react-native';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { PiggyvestCancellationBinding } from './PiggyvestCancellationBinding';
import { PiggyvestDeviceChangeBinding } from './PiggyvestDeviceChangeBinding';
import { PiggyvestDraftClosureBinding } from './PiggyvestDraftClosureBinding';
import { PiggyvestProtectedOfferBinding } from './PiggyvestProtectedOfferBinding';
import { PiggyvestPurchaseBinding } from './PiggyvestPurchaseBinding';
import { PiggyvestDraftReview } from './PiggyvestSavingsScreen.review';
import { piggyvestSavingsStyles as styles } from './PiggyvestSavingsScreen.styles';
import type { PiggyvestSavingsScreenInput } from './PiggyvestSavingsScreen.types';
import { PiggyvestScheduleBinding } from './PiggyvestScheduleBinding';
import { usePiggyvestFundingGate } from './use-piggyvest-funding-gate';

const readinessMessages = {
  continue_saving: 'Continue saving.',
  ready_for_review: 'Your savings are ready for review.',
  review_required: 'Your savings need review.',
  not_available: 'Savings readiness is unavailable.',
};

function money(amount: number) {
  const kobo = BigInt(amount);
  return `NGN ${kobo / 100n}.${String(kobo % 100n).padStart(2, '0')}`;
}
export function PiggyvestSavingsScreen({
  staging,
}: {
  staging: PiggyvestSavingsScreenInput | null;
}) {
  const scheme = useColorScheme();
  const colors = Colors[scheme ?? 'light'];
  const parsed = piggyvestSavingsScreenSchema.safeParse(staging?.source);
  const view = parsed.success ? parsed.data : null;
  const source =
    staging?.environment === 'staging' &&
    view?.status === 'ready' &&
    view.sessionKey === staging.sessionKey &&
    view.goalId === staging.goalId
      ? view
      : null;
  const draft = source?.policy;
  const cancellation = staging?.cancellation;
  const cancellationGate = usePiggyvestFundingGate(cancellation, source);
  const cancellationBlocked = cancellationGate.blocked;
  const purchase = staging?.purchaseBinding;
  const purchaseGate = usePiggyvestFundingGate(purchase, source);
  const purchaseBlocked = purchaseGate.blocked;
  const schedule = staging?.scheduleBinding;
  const scheduleGate = usePiggyvestFundingGate(schedule, source);
  const closure = staging?.draftClosureBinding;
  const closureGate = usePiggyvestFundingGate(closure, source);
  const deviceChange = staging?.deviceChangeBinding;
  const deviceGate = usePiggyvestFundingGate(deviceChange, source);
  const fundingBlocked =
    cancellationBlocked ||
    purchaseBlocked ||
    scheduleGate.blocked ||
    closureGate.blocked ||
    deviceGate.blocked;
  const eligibility = source?.eligibility;
  const allowed =
    !fundingBlocked &&
    source &&
    draft?.consent === 'accepted' &&
    eligibility?.status === 'allowed' &&
    eligibility.sessionKey === source.sessionKey &&
    eligibility.goalId === source.goalId &&
    eligibility.revisionId === draft.revisionId &&
    eligibility.termsHash === draft.terms.hash &&
    eligibility.termsVersion === draft.terms.version;
  const savings = allowed ? source.progress : null;
  const ready =
    savings?.status === 'ready'
      ? {
          ...savings.decision,
          pendingInterestKobo: savings.pendingInterestKobo,
        }
      : null;
  const funding = allowed ? source.funding : null;
  const accounts = funding?.status === 'ready' ? funding.accounts : null;
  const loadingDraft = view?.status === 'loading';
  return (
    <ScrollView
      contentContainerStyle={[
        styles.content,
        { backgroundColor: colors.background },
      ]}
    >
      <Text
        accessibilityRole="header"
        style={[styles.heading, { color: colors.text }]}
      >
        Draft policy review
      </Text>
      <Text style={{ color: colors.textSecondary }}>
        Staging — test environment only. No activation from this screen.
      </Text>
      {staging?.protectedOfferBinding !== undefined && (
        <PiggyvestProtectedOfferBinding
          source={source}
          binding={staging.protectedOfferBinding}
        />
      )}
      {staging?.cancellation !== undefined && (
        <PiggyvestCancellationBinding
          source={source}
          binding={staging.cancellation}
          disabled={
            purchaseBlocked ||
            scheduleGate.blocked ||
            closureGate.blocked ||
            deviceGate.blocked
          }
          isCompatible={() =>
            purchaseGate.isClear() &&
            scheduleGate.isClear() &&
            closureGate.isClear() &&
            deviceGate.isClear()
          }
        />
      )}
      {purchase !== undefined && (
        <PiggyvestPurchaseBinding
          source={source}
          binding={purchase}
          selection={staging?.purchaseSelection}
          disabled={
            cancellationBlocked ||
            scheduleGate.blocked ||
            closureGate.blocked ||
            deviceGate.blocked
          }
          isCompatible={() =>
            cancellationGate.isClear() &&
            scheduleGate.isClear() &&
            closureGate.isClear() &&
            deviceGate.isClear()
          }
        />
      )}
      {schedule !== undefined && (
        <PiggyvestScheduleBinding
          source={source}
          binding={schedule}
          disabled={
            cancellationBlocked ||
            purchaseBlocked ||
            closureGate.blocked ||
            deviceGate.blocked
          }
          isCompatible={() =>
            cancellationGate.isClear() &&
            purchaseGate.isClear() &&
            closureGate.isClear() &&
            deviceGate.isClear()
          }
        />
      )}
      {closure !== undefined && (
        <PiggyvestDraftClosureBinding
          source={source}
          binding={closure}
          disabled={
            cancellationBlocked ||
            purchaseBlocked ||
            scheduleGate.blocked ||
            deviceGate.blocked
          }
          isCompatible={() =>
            cancellationGate.isClear() &&
            purchaseGate.isClear() &&
            scheduleGate.isClear() &&
            deviceGate.isClear()
          }
        />
      )}
      {deviceChange !== undefined && (
        <PiggyvestDeviceChangeBinding
          source={source}
          binding={deviceChange}
          selection={staging?.deviceChangeSelection}
          disabled={
            cancellationBlocked ||
            purchaseBlocked ||
            scheduleGate.blocked ||
            closureGate.blocked
          }
          isCompatible={() =>
            cancellationGate.isClear() &&
            purchaseGate.isClear() &&
            scheduleGate.isClear() &&
            closureGate.isClear()
          }
        />
      )}
      {purchase !== undefined && purchaseBlocked && (
        <Text style={{ color: colors.text }}>
          Funding instructions hidden while purchase requires reconciliation.
          This does not revoke the provider account.
        </Text>
      )}
      {cancellation !== undefined && cancellationBlocked && (
        <Text style={{ color: colors.text }}>
          Funding instructions hidden while cancellation requires
          reconciliation. This does not revoke the provider account.
        </Text>
      )}
      {draft && staging && typeof staging.onAccept === 'function' ? (
        <PiggyvestDraftReview
          key={JSON.stringify([staging.sessionKey, draft])}
          draft={draft}
          onAccept={staging.onAccept}
          colors={colors}
        />
      ) : (
        <Text accessibilityLiveRegion="polite" style={{ color: colors.text }}>
          {loadingDraft
            ? 'Loading draft terms…'
            : 'Draft review is unavailable.'}
        </Text>
      )}
      <View style={[styles.section, { borderColor: colors.border }]}>
        <Text
          accessibilityRole="header"
          style={[styles.label, { color: colors.text }]}
        >
          Savings status
        </Text>
        <Text accessibilityLiveRegion="polite" style={{ color: colors.text }}>
          {ready
            ? readinessMessages[ready.readiness]
            : draft && savings?.status === 'loading'
              ? 'Loading savings status…'
              : draft && savings?.status === 'pending_wallet'
                ? 'Your savings wallet is pending confirmation.'
                : 'Savings status is unavailable.'}
        </Text>
        {ready && (
          <>
            <Text style={{ color: colors.text }}>
              Server-confirmed purchasing power
            </Text>
            <Text style={{ color: colors.text }}>
              {money(ready.purchasingPowerKobo)}
            </Text>
            <Text style={{ color: colors.text }}>
              Device price: {money(ready.devicePriceKobo)}
            </Text>
            <Text style={{ color: colors.text }}>
              Pending interest (not spendable):{' '}
              {ready.pendingInterestKobo === null
                ? 'Unavailable'
                : money(ready.pendingInterestKobo)}
            </Text>
          </>
        )}
      </View>
      <View style={[styles.section, { borderColor: colors.border }]}>
        <Text
          accessibilityRole="header"
          style={[styles.label, { color: colors.text }]}
        >
          Funding details
        </Text>
        {accounts ? (
          accounts.map((account) => (
            <View key={JSON.stringify(account)}>
              <Text style={{ color: colors.text }}>{account.bankName}</Text>
              <Text style={{ color: colors.text }}>{account.accountName}</Text>
              <Text style={{ color: colors.text }}>
                {account.accountNumber}
              </Text>
            </View>
          ))
        ) : (
          <Text accessibilityLiveRegion="polite" style={{ color: colors.text }}>
            {draft && funding?.status === 'pending'
              ? 'Funding details are pending confirmation.'
              : 'Funding details are unavailable.'}
          </Text>
        )}
      </View>
    </ScrollView>
  );
}
