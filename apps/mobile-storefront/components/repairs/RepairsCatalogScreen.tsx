import type {
  RepairDeviceSummary,
  RepairQuoteSummary,
} from '@baci/shared/repairs';
import * as Haptics from 'expo-haptics';
import { router, Stack } from 'expo-router';
import { usePreventRemove } from 'expo-router/react-navigation';
import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  Text,
  View,
} from 'react-native';
import { RepairBookingForm } from '@/components/repairs/RepairBookingForm';
import { RepairBookingSuccess } from '@/components/repairs/RepairBookingSuccess';
import { RepairDeviceCatalog } from '@/components/repairs/RepairDeviceCatalog';
import { RepairDeviceDetailView } from '@/components/repairs/RepairDeviceDetailView';
import { RepairsFallback } from '@/components/repairs/RepairsFallback';
import { repairsCatalogStyles as styles } from '@/components/repairs/repairs-catalog.styles';
import { buildRepairWhatsappUrl } from '@/components/repairs/repairs-content';
import { useColorScheme } from '@/components/useColorScheme';
import Colors, { BRAND } from '@/constants/Colors';
import { SUPPORT_WHATSAPP_PHONE } from '@/constants/Support';
import { useRepairBooking } from '@/hooks/use-repair-booking';
import { useRepairDeviceDetail } from '@/hooks/use-repair-device-detail';
import { useRepairDevices } from '@/hooks/use-repair-devices';

type Step = 'catalog' | 'detail' | 'form';

const STEP_TITLES: Record<Step, string> = {
  catalog: 'Repairs',
  detail: 'Repair options',
  form: 'Book a repair',
};

function openWhatsapp(service?: string) {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  Linking.openURL(buildRepairWhatsappUrl(SUPPORT_WHATSAPP_PHONE, service));
}

/**
 * Device-first repairs flow container: catalogue → device detail (quotes) →
 * booking form → ticket success. Replaces the WhatsApp-only "Repair Lab"
 * screen, but degrades to it (`RepairsFallback`) when the merchant's repairs
 * catalogue is unavailable (feature flag off / read API 404) — that 404 is
 * the mobile-side feature gate, so a repairs-off merchant keeps today's
 * behaviour. WhatsApp stays as a secondary "chat with a technician" fallback.
 */
export function RepairsCatalogScreen() {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];

  const devices = useRepairDevices();
  const [step, setStep] = useState<Step>('catalog');
  const [device, setDevice] = useState<RepairDeviceSummary | null>(null);
  const [quote, setQuote] = useState<RepairQuoteSummary | null>(null);

  const detail = useRepairDeviceDetail(
    step === 'detail' ? (device?.slug ?? '') : ''
  );
  const booking = useRepairBooking();

  const showSuccess = booking.result !== null;
  const pickupBack = useRef<(() => void) | null>(null);

  const goBackOneStep = () => {
    if (pickupBack.current) {
      pickupBack.current();
      return;
    }
    if (step === 'form') {
      setStep(device ? 'detail' : 'catalog');
      return;
    }
    if (step === 'detail') {
      setDevice(null);
      setStep('catalog');
    }
  };

  // Intercept the native back gesture/button while mid-flow so it steps back
  // through the catalogue instead of popping the whole screen. On the
  // catalogue (or the terminal success view) back leaves normally.
  usePreventRemove(step !== 'catalog' && !showSuccess, goBackOneStep);

  const handleSelectDevice = (selected: RepairDeviceSummary) => {
    setDevice(selected);
    setQuote(null);
    setStep('detail');
  };

  const handleBookQuote = (selected: RepairQuoteSummary | null) => {
    setQuote(selected);
    setStep('form');
  };

  const handleDescribeInstead = () => {
    setDevice(null);
    setQuote(null);
    setStep('form');
  };

  const handleDone = () => {
    booking.reset();
    setDevice(null);
    setQuote(null);
    setStep('catalog');
  };

  const screen = (
    <Stack.Screen
      options={{
        title: showSuccess ? 'Confirmed' : STEP_TITLES[step],
        headerRight: () => (
          <Pressable
            accessibilityRole="button"
            hitSlop={12}
            style={{ minHeight: 44, justifyContent: 'center' }}
            onPress={() => router.push('/repairs/status')}
          >
            <Text style={{ color: BRAND.primary }}>Track repair</Text>
          </Pressable>
        ),
      }}
    />
  );

  if (devices.isUnavailable) {
    return (
      <>
        {screen}
        <RepairsFallback />
      </>
    );
  }

  if (showSuccess && booking.result) {
    return (
      <>
        {screen}
        <RepairBookingSuccess
          ticketNumber={booking.result.ticketNumber}
          onDone={handleDone}
        />
      </>
    );
  }

  if (step === 'form') {
    return (
      <>
        {screen}
        <RepairBookingForm
          device={device}
          quote={quote}
          isSubmitting={booking.isSubmitting}
          serverError={booking.error}
          fieldErrors={booking.fieldErrors}
          onSubmit={booking.submit}
          navigationBackRef={pickupBack}
        />
      </>
    );
  }

  if (step === 'detail') {
    if (detail.isLoading) {
      return (
        <>
          {screen}
          <View
            style={[styles.centered, { backgroundColor: colors.background }]}
          >
            <ActivityIndicator
              size="large"
              color={BRAND.primary}
              accessibilityLabel="Loading device"
            />
          </View>
        </>
      );
    }
    if (detail.detail) {
      return (
        <>
          {screen}
          <RepairDeviceDetailView
            detail={detail.detail}
            onBookQuote={handleBookQuote}
          />
        </>
      );
    }
    return (
      <>
        {screen}
        <View style={[styles.centered, { backgroundColor: colors.background }]}>
          <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
            {detail.isNotFound
              ? "We couldn't find that device."
              : (detail.error ?? 'Something went wrong.')}
          </Text>
          {!detail.isNotFound ? (
            <Pressable
              style={styles.secondaryButton}
              onPress={detail.refetch}
              accessibilityRole="button"
              accessibilityLabel="Retry loading device"
            >
              <Text style={styles.secondaryButtonText}>Try again</Text>
            </Pressable>
          ) : null}
          <Pressable
            style={styles.secondaryButton}
            onPress={goBackOneStep}
            accessibilityRole="button"
            accessibilityLabel="Back to devices"
          >
            <Text style={styles.secondaryButtonText}>Back to devices</Text>
          </Pressable>
        </View>
      </>
    );
  }

  // step === 'catalog'
  if (devices.isLoading) {
    return (
      <>
        {screen}
        <View style={[styles.centered, { backgroundColor: colors.background }]}>
          <ActivityIndicator
            size="large"
            color={BRAND.primary}
            accessibilityLabel="Loading repairs"
          />
        </View>
      </>
    );
  }

  if (devices.error) {
    return (
      <>
        {screen}
        <View style={[styles.centered, { backgroundColor: colors.background }]}>
          <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
            {devices.error}
          </Text>
          <Pressable
            style={styles.secondaryButton}
            onPress={devices.refetch}
            accessibilityRole="button"
            accessibilityLabel="Retry loading repairs"
          >
            <Text style={styles.secondaryButtonText}>Try again</Text>
          </Pressable>
        </View>
      </>
    );
  }

  return (
    <>
      {screen}
      <RepairDeviceCatalog
        groups={devices.groups}
        brandGroups={devices.brandGroups}
        query={devices.query}
        onQueryChange={devices.setQuery}
        onSelectDevice={handleSelectDevice}
        onDescribeInstead={handleDescribeInstead}
        onChatWhatsapp={() => openWhatsapp()}
      />
    </>
  );
}
