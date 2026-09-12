import type {
  RepairDeviceSummary,
  RepairQuoteSummary,
} from '@baci/shared/repairs';
import Ionicons from '@react-native-vector-icons/ionicons';
import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { RepairTextField } from '@/components/repairs/RepairTextField';
import { repairBookingStyles as booking } from '@/components/repairs/repair-booking.styles';
import {
  buildBookingPayload,
  type RepairBookingFieldErrors,
  type RepairBookingFormState,
  validateBookingForm,
} from '@/components/repairs/repair-booking-form-model';
import { formatQuotePrice } from '@/components/repairs/repair-quote-format';
import { repairsCatalogStyles as styles } from '@/components/repairs/repairs-catalog.styles';
import { useColorScheme } from '@/components/useColorScheme';
import Colors, { BRAND } from '@/constants/Colors';
import type { RepairBookingRequest } from '@/lib/repair-catalog-schemas';

interface RepairBookingFormProps {
  /** Preselected catalogue device, or null for the free-text path. */
  device: RepairDeviceSummary | null;
  /** Preselected catalogue quote, or null. */
  quote: RepairQuoteSummary | null;
  isSubmitting: boolean;
  serverError: string | null;
  /** Field-level errors returned by the server (keyed by request field). */
  fieldErrors: Record<string, string[]> | null;
  onSubmit: (payload: RepairBookingRequest) => void;
}

const INITIAL_STATE: RepairBookingFormState = {
  customerName: '',
  customerEmail: '',
  customerPhone: '',
  deviceModel: '',
  issueDescription: '',
  serviceType: 'dropoff',
  pickupAddress: '',
};

function serverFieldError(
  fieldErrors: Record<string, string[]> | null,
  key: string
): string | undefined {
  return fieldErrors?.[key]?.[0];
}

export function RepairBookingForm({
  device,
  quote,
  isSubmitting,
  serverError,
  fieldErrors,
  onSubmit,
}: RepairBookingFormProps) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const [state, setState] = useState<RepairBookingFormState>({
    ...INITIAL_STATE,
    deviceModel: device?.model ?? '',
  });
  const [errors, setErrors] = useState<RepairBookingFieldErrors>({});

  const update = <K extends keyof RepairBookingFormState>(
    key: K,
    value: RepairBookingFormState[K]
  ) => {
    setState((prev) => ({ ...prev, [key]: value }));
    if (errors[key]) {
      setErrors((prev) => ({ ...prev, [key]: undefined }));
    }
  };

  const handleSubmit = () => {
    if (isSubmitting) return;
    const validationErrors = validateBookingForm(state);
    setErrors(validationErrors);
    if (Object.keys(validationErrors).length > 0) return;

    onSubmit(
      buildBookingPayload(
        state,
        device?.deviceType ?? 'Other',
        device?.id ?? null,
        quote?.id ?? null
      )
    );
  };

  const errorFor = (key: keyof RepairBookingFormState, serverKey: string) =>
    errors[key] ?? serverFieldError(fieldErrors, serverKey);

  return (
    <ScrollView
      style={styles.scrollView}
      contentContainerStyle={styles.scrollContent}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      {device ? (
        <View
          style={[
            booking.summaryCard,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <Text style={[booking.summaryTitle, { color: colors.textSecondary }]}>
            Booking
          </Text>
          <Text style={[booking.summaryDevice, { color: colors.text }]}>
            {device.model}
          </Text>
          {quote ? (
            <Text
              style={[booking.summaryQuote, { color: colors.textSecondary }]}
            >
              {quote.serviceTypeName} · {formatQuotePrice(quote)}
            </Text>
          ) : null}
        </View>
      ) : null}

      {!device ? (
        <RepairTextField
          label="Device model"
          placeholder="e.g. Nokia 3310"
          value={state.deviceModel}
          onChangeText={(v) => update('deviceModel', v)}
          error={errorFor('deviceModel', 'deviceModel')}
        />
      ) : null}

      <RepairTextField
        label="Full name"
        placeholder="Your name"
        value={state.customerName}
        onChangeText={(v) => update('customerName', v)}
        error={errorFor('customerName', 'customerName')}
      />
      <RepairTextField
        label="Email"
        placeholder="you@example.com"
        value={state.customerEmail}
        onChangeText={(v) => update('customerEmail', v)}
        error={errorFor('customerEmail', 'customerEmail')}
        keyboardType="email-address"
        autoCapitalize="none"
      />
      <RepairTextField
        label="Phone number"
        placeholder="080..."
        value={state.customerPhone}
        onChangeText={(v) => update('customerPhone', v)}
        error={errorFor('customerPhone', 'customerPhone')}
        keyboardType="phone-pad"
      />
      <RepairTextField
        label="Describe the issue"
        placeholder="What's wrong with your device?"
        value={state.issueDescription}
        onChangeText={(v) => update('issueDescription', v)}
        error={errorFor('issueDescription', 'issueDescription')}
        multiline
      />

      <Text style={[booking.label, { color: colors.textSecondary }]}>
        How would you like to proceed?
      </Text>
      <View style={booking.methodRow}>
        <Pressable
          style={[
            booking.methodOption,
            {
              borderColor: BRAND.primary,
              backgroundColor: BRAND.primaryAlpha06,
            },
          ]}
          accessibilityRole="radio"
          accessibilityState={{ checked: true }}
          accessibilityLabel="Drop-off"
        >
          <Text style={[booking.methodOptionText, { color: BRAND.primary }]}>
            Drop-off
          </Text>
        </Pressable>
      </View>
      <Text
        style={[booking.pickupUnavailableNote, { color: colors.textSecondary }]}
        accessibilityRole="text"
      >
        Courier pickup will be available in a future update. Please drop off
        your device at the repair center for now.
      </Text>

      {serverError ? (
        <Text
          style={[booking.fieldError, { color: colors.error, marginBottom: 8 }]}
          accessibilityLiveRegion="polite"
        >
          {serverError}
        </Text>
      ) : null}

      <Pressable
        style={[
          styles.primaryButton,
          isSubmitting && styles.primaryButtonDisabled,
        ]}
        onPress={handleSubmit}
        disabled={isSubmitting}
        accessibilityRole="button"
        accessibilityLabel="Submit repair request"
      >
        {isSubmitting ? (
          <ActivityIndicator color="#FFF" />
        ) : (
          <>
            <Text style={styles.primaryButtonText}>Request repair</Text>
            <Ionicons name="arrow-forward" size={18} color="#FFF" />
          </>
        )}
      </Pressable>
    </ScrollView>
  );
}
