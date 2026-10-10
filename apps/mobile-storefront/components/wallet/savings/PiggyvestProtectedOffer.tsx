import { piggyvestProtectedOfferSchemas as schemas } from '@baci/shared/contracts';
import { formatPiggyvestPurchaseMoney as money } from '@baci/shared/lib';
import { Text, View } from 'react-native';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { piggyvestSavingsStyles as styles } from './PiggyvestSavingsScreen.styles';

export function PiggyvestProtectedOffer({
  observation,
}: {
  observation: unknown;
}) {
  const colors = Colors[useColorScheme() ?? 'light'];
  const parsed = schemas.observation.safeParse(observation);
  if (!parsed.success)
    return (
      <Text style={{ color: colors.text }}>Protected offer unavailable.</Text>
    );
  const evidence = parsed.data;
  const receipt = evidence.receipt;
  return (
    <View style={[styles.section, { borderColor: colors.border }]}>
      <Text
        accessibilityRole="header"
        style={[styles.label, { color: colors.text }]}
      >
        Seven-day protected device offer
      </Text>
      <Text accessibilityLiveRegion="polite" style={{ color: colors.text }}>
        Server observed: {evidence.pricePromise} at {evidence.observedAt}
      </Text>
      <Text style={{ color: colors.text }}>
        Recorded device price: {money(receipt.priceKobo)}
      </Text>
      <Text style={{ color: colors.text }}>
        Condition: {receipt.device.condition}
      </Text>
      <Text style={{ color: colors.text }}>
        Recorded window: {receipt.startsAt} to {receipt.expiresAt}
      </Text>
      <Text style={{ color: colors.text }}>
        Honoured throughout the recorded seven-day window even if the catalogue
        price rises. Device price only; delivery, taxes and fees require
        checkout review.
      </Text>
      {evidence.pricePromise !== 'active' && (
        <Text style={{ color: colors.text }}>
          This observation does not authorize use of the recorded offer price
          and does not cancel any still-valid original guarantee. Request fresh
          server pricing.
        </Text>
      )}
      <Text style={{ color: colors.text }}>
        Checkout must revalidate funds and conflicting reservations. No stock
        reservation, purchase, automatic collection or provider dispatch is
        authorized. No offer acceptance is required here.
      </Text>
      <Text style={{ color: colors.text }}>
        Terms version: {receipt.termsVersion}
      </Text>
    </View>
  );
}
