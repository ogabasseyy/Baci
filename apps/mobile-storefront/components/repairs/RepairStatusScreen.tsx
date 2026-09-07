import { Stack } from 'expo-router';
import { useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text } from 'react-native';
import { RepairTextField } from '@/components/repairs/RepairTextField';
import { repairsCatalogStyles as styles } from '@/components/repairs/repairs-catalog.styles';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { repairPickupClient } from '@/lib/repair-pickup-client';

export function RepairStatusScreen() {
  const colors = Colors[useColorScheme() ?? 'light'];
  const [ticket, setTicket] = useState('');
  const [email, setEmail] = useState('');
  const [result, setResult] = useState<Awaited<
    ReturnType<typeof repairPickupClient.status>
  > | null>(null);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  async function lookup() {
    if (inFlight.current) return;
    if (!/^[1-9]\d*$/.test(ticket.trim()) || !email.trim()) {
      setError('Enter your ticket number and booking email.');
      return;
    }
    inFlight.current = true;
    setBusy(true);
    setError(undefined);
    setResult(null);
    try {
      setResult(
        await repairPickupClient.status(
          Number(ticket),
          email.trim().toLowerCase()
        )
      );
    } catch {
      setError('Could not load repair status. Please try again.');
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  return (
    <>
      <Stack.Screen options={{ title: 'Track repair' }} />
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <RepairTextField
          label="Ticket number"
          value={ticket}
          onChangeText={setTicket}
          keyboardType="number-pad"
        />
        <RepairTextField
          label="Booking email"
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
        />
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          style={styles.primaryButton}
          onPress={lookup}
        >
          <Text style={styles.primaryButtonText}>Check repair status</Text>
        </Pressable>
        {busy && <ActivityIndicator />}
        {error && (
          <Text accessibilityRole="alert" style={{ color: colors.error }}>
            {error}
          </Text>
        )}
        {result?.found === false && (
          <Text style={{ color: colors.text }}>
            No matching repair. Check your ticket and email.
          </Text>
        )}
        {result?.found && (
          <>
            <Text style={{ color: colors.text }}>
              Repair status: {result.repair.status.replaceAll('_', ' ')}
            </Text>
            {result.repair.pickupPaymentStatus && (
              <Text style={{ color: colors.text }}>
                Pickup status:{' '}
                {result.repair.pickupPaymentStatus.replaceAll('_', ' ')}
              </Text>
            )}
            {result.repair.trackingNumber && (
              <Text selectable style={{ color: colors.text }}>
                GIGL waybill: {result.repair.trackingNumber}
              </Text>
            )}
          </>
        )}
      </ScrollView>
    </>
  );
}
