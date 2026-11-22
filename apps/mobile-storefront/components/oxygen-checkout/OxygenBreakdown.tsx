import Ionicons from '@react-native-vector-icons/ionicons';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { OxygenActionFooter } from './OxygenActionFooter';
import { useOxygenColors } from './OxygenFormPrimitives';
import { formatOxygenPaymentDate } from './oxygen-payment-date';
import type { OxygenConfirmedTerms } from './oxygen-plan';
import {
  OxygenAction,
  oxygenMoney,
  oxygenPresentation as styles,
} from './oxygen-presentation';
export function OxygenBreakdown({
  terms,
  busy = false,
  canChangePlan = true,
  onAccept,
  onChangePlan,
}: {
  terms: OxygenConfirmedTerms;
  busy?: boolean;
  canChangePlan?: boolean;
  onAccept: () => void;
  onChangePlan: () => void;
}) {
  const [dates, setDates] = useState(false);
  const colors = useOxygenColors();
  const finalPayment = terms.schedule.at(-1);
  return (
    <View style={[styles.section, { padding: 0 }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Ionicons
          name="checkmark-circle-outline"
          size={21}
          color={colors.primary}
        />
        <Text
          style={{ color: colors.primary, fontWeight: '700', fontSize: 13 }}
        >
          YOUR PAYMENT PLAN
        </Text>
      </View>
      <Text
        accessibilityRole="header"
        style={[styles.title, { color: colors.text }]}
      >
        Your confirmed payment breakdown
      </Text>
      <Text style={{ color: colors.textSecondary, lineHeight: 22 }}>
        Review your payment amounts and dates before you continue.
      </Text>
      <View
        style={{
          backgroundColor: colors.card,
          borderColor: colors.border,
          borderWidth: 1,
          borderRadius: 16,
          padding: 16,
          gap: 16,
        }}
      >
        <View
          style={{
            gap: 6,
            backgroundColor: colors.primaryLowOpacity,
            borderRadius: 12,
            padding: 14,
          }}
        >
          <Text style={{ color: colors.textSecondary, fontWeight: '600' }}>
            Due upfront
          </Text>
          <Text style={[styles.title, { color: colors.text }]}>
            {oxygenMoney(terms.upfront)}
          </Text>
          <Text style={{ color: colors.textSecondary }}>
            Includes {oxygenMoney(terms.charges)} in charges
          </Text>
        </View>
        <View style={{ gap: 4 }}>
          <Text style={{ color: colors.textSecondary }}>Monthly repayment</Text>
          <Text style={[styles.title, { color: colors.text }]}>
            {oxygenMoney(terms.monthly)}
          </Text>
          <Text style={{ color: colors.textSecondary }}>
            {terms.schedule.length} payments · see dates and amounts below
          </Text>
          {finalPayment && finalPayment.amount !== terms.monthly ? (
            <Text style={{ color: colors.textSecondary }}>
              Final payment: {oxygenMoney(finalPayment.amount)}
            </Text>
          ) : null}
        </View>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={dates ? 'Hide payment dates' : 'Show payment dates'}
        accessibilityState={{ expanded: dates }}
        onPress={() => setDates(!dates)}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.card,
          borderRadius: 14,
          padding: 15,
          minHeight: 52,
        }}
      >
        <Ionicons name="calendar-outline" size={20} color={colors.primary} />
        <Text style={{ color: colors.text, fontWeight: '600', flex: 1 }}>
          {dates ? 'Hide payment dates' : 'Show payment dates'}
        </Text>
        <Ionicons
          name={dates ? 'chevron-up' : 'chevron-down'}
          size={18}
          color={colors.primary}
        />
      </Pressable>
      {dates &&
        terms.schedule.map((row) => (
          <View
            key={row.period}
            style={{
              flexDirection: 'row',
              flexWrap: 'wrap',
              justifyContent: 'space-between',
              gap: 8,
              borderColor: colors.border,
              borderWidth: 1,
              borderRadius: 12,
              padding: 14,
            }}
          >
            <Text style={{ color: colors.textSecondary }}>
              {formatOxygenPaymentDate(row.date)}
            </Text>
            <Text style={{ color: colors.text, fontWeight: '600' }}>
              {oxygenMoney(row.amount)}
            </Text>
          </View>
        ))}
      <OxygenActionFooter>
        <OxygenAction
          label="Accept payment plan"
          disabled={busy}
          onPress={onAccept}
        />
        {canChangePlan ? (
          <OxygenAction
            secondary
            label="Change payment selection"
            disabled={busy}
            onPress={onChangePlan}
          />
        ) : null}
      </OxygenActionFooter>
    </View>
  );
}
