import Ionicons from '@react-native-vector-icons/ionicons';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import type { OrderGiglExternalWaybill } from '@/hooks/orders/useOrderGiglExternalWaybill';
import { useTheme } from '@/hooks/useTheme';
import type { GiglExternalWaybillPreview } from '@/schemas/gigl-external-waybill';
import { ShipmentOptionCard } from './ShipmentOptionCard';

interface Props {
  externalWaybill: OrderGiglExternalWaybill;
  onSelect: () => void;
  selected: boolean;
}

type FieldMatch = GiglExternalWaybillPreview['match']['name'];

function CheckRow({
  label,
  match,
  value,
}: {
  label: string;
  match?: FieldMatch;
  value: string;
}) {
  const { colors } = useTheme();
  const icon =
    match === 'match'
      ? 'checkmark-circle'
      : match === 'mismatch'
        ? 'close-circle'
        : 'ellipse-outline';
  const tint =
    match === 'match'
      ? colors.primary
      : match === 'mismatch'
        ? colors.error
        : colors.textMuted;
  const status =
    match === 'match'
      ? 'matches the order'
      : match === 'mismatch'
        ? 'does not match the order'
        : '';
  return (
    <View
      accessibilityLabel={`${label}: ${value}${status ? `, ${status}` : ''}`}
      style={styles.row}
    >
      {match ? <Ionicons color={tint} name={icon} size={18} /> : null}
      <Text style={[styles.rowLabel, { color: colors.textSecondary }]}>
        {label}
      </Text>
      <Text style={[styles.rowValue, { color: colors.text }]}>{value}</Text>
    </View>
  );
}

function PreviewCard({ preview }: { preview: GiglExternalWaybillPreview }) {
  const { colors } = useTheme();
  const { gig, match } = preview;
  if (!gig) {
    return (
      <Text style={[styles.message, { color: colors.error }]}>
        This waybill does not match this order&apos;s customer and delivery
        address. Check the waybill number.
      </Text>
    );
  }
  return (
    <View style={[styles.card, { borderColor: colors.border }]}>
      <CheckRow
        label="Receiver"
        match={match.name}
        value={gig.receiverName ?? 'Not given'}
      />
      <CheckRow
        label="Phone"
        match={match.phone}
        value={
          gig.receiverPhoneLast4
            ? `•••• ${gig.receiverPhoneLast4}`
            : 'Not given'
        }
      />
      <CheckRow
        label="Destination"
        match={match.destination}
        value={gig.destinationState ?? 'Not given'}
      />
      <CheckRow
        label="Delivery"
        value={
          gig.deliveryType === 'station'
            ? `Pickup at GIG centre${gig.stationAddress ? `: ${gig.stationAddress}` : ''}`
            : 'Home delivery'
        }
      />
      {gig.trackingStatus ? (
        <CheckRow
          label="GIG status"
          value={
            gig.lastUpdate
              ? `${gig.trackingStatus} · ${gig.lastUpdate.description}`
              : gig.trackingStatus
          }
        />
      ) : null}
      <Text
        style={[
          styles.message,
          { color: preview.linkable ? colors.textSecondary : colors.error },
        ]}
      >
        {preview.linkable
          ? 'Attach it to track this parcel and update you and the customer. No wallet charge.'
          : 'The destination on this waybill does not match this order. Update the delivery address or check the waybill.'}
      </Text>
    </View>
  );
}

export function ShipmentFlowGiglWaybillPanel({
  externalWaybill,
  onSelect,
  selected,
}: Props) {
  const { colors } = useTheme();
  const { error, preview, setWaybill, state, waybill } = externalWaybill;
  const busy = state === 'checking' || state === 'linking';

  return (
    <View>
      <ShipmentOptionCard
        colors={colors}
        description="Booked it in the GIG app? Enter the waybill. Baci checks it with GIG, then tracks the parcel."
        icon="document-text-outline"
        onPress={onSelect}
        selected={selected}
        title="Already booked on GIG?"
      />
      {selected ? (
        <View style={styles.body}>
          <Text style={{ color: colors.text }}>GIG waybill number</Text>
          <TextInput
            accessibilityLabel="GIG waybill number"
            autoCapitalize="characters"
            autoCorrect={false}
            editable={!busy}
            onChangeText={setWaybill}
            placeholder="e.g. 1349639588"
            placeholderTextColor={colors.textMuted}
            style={[
              styles.input,
              { borderColor: colors.border, color: colors.text },
            ]}
            value={waybill}
          />
          {state === 'checking' ? (
            <Text style={[styles.message, { color: colors.textSecondary }]}>
              Checking with GIG Logistics…
            </Text>
          ) : null}
          {error ? (
            <Text
              accessibilityRole="alert"
              style={[styles.message, { color: colors.error }]}
            >
              {error}
            </Text>
          ) : null}
          {preview ? <PreviewCard preview={preview} /> : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  body: { gap: 8, marginBottom: 12, paddingHorizontal: 4 },
  card: { borderRadius: 12, borderWidth: 1, gap: 8, padding: 12 },
  input: {
    borderRadius: 10,
    borderWidth: 1,
    minHeight: 44,
    paddingHorizontal: 12,
  },
  message: { fontSize: 13, lineHeight: 18 },
  row: { alignItems: 'center', flexDirection: 'row', gap: 8 },
  rowLabel: { fontSize: 13, width: 84 },
  rowValue: { flex: 1, fontSize: 14 },
});
