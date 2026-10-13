import Ionicons from '@react-native-vector-icons/ionicons';
import { useQuery } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StatusBar,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import CacVerificationCard from '@/components/kyc/CacVerificationCard';
import { styles } from '@/components/kyc/kyc-screen.styles';
import NinVerificationCard from '@/components/kyc/NinVerificationCard';
import type { VerificationIdentityDraft } from '@/components/kyc/verification-identity';
import { AppKeyboardContainer } from '@/components/ui/AppKeyboardContainer';
import { useAuth } from '@/hooks/useAuth';
import { useKycVerificationRefresh } from '@/hooks/useKycVerificationRefresh';
import { useMerchant } from '@/hooks/useMerchant';
import { useTheme } from '@/hooks/useTheme';
import { isBaciPaystackSettlementCountry } from '@/lib/is-baci-paystack-settlement-country';
import { supabase } from '@/lib/supabase';

interface VerificationStatus {
  nin_verified: boolean;
  bvn_verified: boolean;
  cac_verified: boolean;
  cac_approved_name: string | null;
  first_name: string | null;
  last_name: string | null;
  date_of_birth: string | null;
}

const EMPTY_IDENTITY_DRAFT: VerificationIdentityDraft = {
  dateOfBirth: '',
  firstName: '',
  lastName: '',
  mobileNo: '',
};

function isVerificationStatus(value: unknown): value is VerificationStatus {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.nin_verified === 'boolean' &&
    typeof v.bvn_verified === 'boolean' &&
    typeof v.cac_verified === 'boolean'
  );
}

function normalizeBvnMobileNumber(value: string | null | undefined): string {
  const digits = value?.replace(/\D/g, '') ?? '';

  if (!digits) return '';
  if (digits.length === 11 && digits.startsWith('0')) return digits;
  if (digits.length === 13 && digits.startsWith('234')) {
    return `0${digits.slice(3)}`;
  }

  return '';
}

export default function KYCScreen() {
  const { colors, isDark } = useTheme();
  const { user } = useAuth();
  const { merchant } = useMerchant();
  const lastMerchantIdRef = useRef<string | null>(null);
  const activeMerchantIdRef = useRef<string | null>(null);
  const merchantId = merchant?.id ?? null;
  useLayoutEffect(() => {
    activeMerchantIdRef.current = merchantId;
  }, [merchantId]);
  const [identityDraft, setIdentityDraft] =
    useState<VerificationIdentityDraft>(EMPTY_IDENTITY_DRAFT);
  const [identityDraftMerchantId, setIdentityDraftMerchantId] = useState<
    string | null
  >(null);
  const visibleIdentityDraft =
    identityDraftMerchantId === merchantId
      ? identityDraft
      : EMPTY_IDENTITY_DRAFT;

  const isOwner =
    !!user?.id && !!merchant?.user_id && user.id === merchant.user_id;
  const supportsNigerianVerification = isBaciPaystackSettlementCountry(
    merchant?.country
  );

  const {
    data: status,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ['verification-status', merchant?.id],
    queryFn: async () => {
      if (!merchant?.id) throw new Error('Merchant ID is required');
      const { data, error } = await supabase.rpc(
        'get_merchant_verification_status',
        { p_merchant_id: merchant.id }
      );
      if (error) throw error;
      if (!isVerificationStatus(data)) {
        throw new Error(
          'Invalid verification status payload from get_merchant_verification_status'
        );
      }
      return data;
    },
    enabled: isOwner && supportsNigerianVerification && !!merchant?.id,
    staleTime: 1000 * 60 * 5,
  });
  const { refreshAfterVerification } = useKycVerificationRefresh({
    merchantId,
    refetchVerificationStatus: refetch,
  });
  const isVerificationSessionActive = () =>
    activeMerchantIdRef.current === merchantId;

  useEffect(() => {
    const merchantId = merchant?.id ?? null;
    const merchantChanged = lastMerchantIdRef.current !== merchantId;

    setIdentityDraft((current) => ({
      dateOfBirth: merchantChanged
        ? status?.date_of_birth || ''
        : current.dateOfBirth || status?.date_of_birth || '',
      firstName: merchantChanged
        ? status?.first_name || ''
        : current.firstName || status?.first_name || '',
      lastName: merchantChanged
        ? status?.last_name || ''
        : current.lastName || status?.last_name || '',
      mobileNo: merchantChanged
        ? normalizeBvnMobileNumber(merchant?.phone) || ''
        : current.mobileNo || normalizeBvnMobileNumber(merchant?.phone) || '',
    }));
    lastMerchantIdRef.current = merchantId;
    setIdentityDraftMerchantId(merchantId);
  }, [
    merchant?.id,
    merchant?.phone,
    status?.date_of_birth,
    status?.first_name,
    status?.last_name,
  ]);

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Identity Verification',
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.text,
          headerShadowVisible: false,
        }}
      />
      <SafeAreaView
        style={[styles.container, { backgroundColor: colors.background }]}
        edges={['bottom']}
      >
        <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />

        <AppKeyboardContainer
          align="start"
          contentContainerStyle={styles.scrollContent}
          keyboardVerticalOffset={0}
        >
          <View style={styles.header}>
            <View
              style={[
                styles.iconCircle,
                { backgroundColor: `${colors.primary}15` },
              ]}
            >
              <Ionicons
                name="shield-checkmark-outline"
                size={40}
                color={colors.primary}
              />
            </View>
            <Text style={[styles.title, { color: colors.text }]}>
              KYC Verification
            </Text>
            <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
              Verify your identity to enable full payment features and build
              customer trust.
            </Text>
          </View>

          {!isOwner ? (
            <View
              style={[styles.ownerOnlyBanner, { backgroundColor: colors.card }]}
            >
              <Ionicons
                name="lock-closed-outline"
                size={24}
                color={colors.textMuted}
              />
              <Text
                style={[styles.ownerOnlyText, { color: colors.textSecondary }]}
              >
                Only the store owner can verify identity. Contact your store
                owner to complete verification.
              </Text>
            </View>
          ) : !supportsNigerianVerification ? (
            <View
              style={[styles.ownerOnlyBanner, { backgroundColor: colors.card }]}
            >
              <Ionicons
                name="information-circle-outline"
                size={24}
                color={colors.textMuted}
              />
              <Text
                style={[styles.ownerOnlyText, { color: colors.textSecondary }]}
              >
                Identity verification is only available for Nigerian merchants.
              </Text>
            </View>
          ) : isLoading ? (
            <ActivityIndicator
              size="large"
              color={colors.primary}
              style={styles.loader}
            />
          ) : isError ? (
            <View
              style={[styles.ownerOnlyBanner, { backgroundColor: colors.card }]}
            >
              <Ionicons
                name="alert-circle-outline"
                size={24}
                color={colors.error}
              />
              <View style={styles.errorBody}>
                <Text
                  style={[
                    styles.ownerOnlyText,
                    { color: colors.textSecondary },
                  ]}
                >
                  Failed to load verification status.
                </Text>
                <Pressable onPress={() => refetch()} accessibilityRole="button">
                  <Text
                    style={[styles.tryAgainText, { color: colors.primary }]}
                  >
                    Try Again
                  </Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <View key={merchant?.id ?? 'no-merchant'} style={styles.cards}>
              <NinVerificationCard
                bvnVerified={status?.bvn_verified ?? false}
                verified={status?.nin_verified ?? false}
                prefillBvn={merchant?.bvn}
                prefillNin={merchant?.nin}
                firstName={visibleIdentityDraft.firstName}
                lastName={visibleIdentityDraft.lastName}
                merchantId={merchantId}
                dateOfBirth={visibleIdentityDraft.dateOfBirth}
                mobileNo={visibleIdentityDraft.mobileNo}
                onIdentityChange={setIdentityDraft}
                isActive={isVerificationSessionActive}
                onVerified={refreshAfterVerification}
              />
              <CacVerificationCard
                verified={status?.cac_verified ?? false}
                prefillRcNumber={merchant?.cac_rc_number}
                cacApprovedName={status?.cac_approved_name}
                merchantId={merchantId}
                isActive={isVerificationSessionActive}
                onVerified={refreshAfterVerification}
              />
            </View>
          )}

          <View style={styles.securityNote}>
            <Ionicons
              name="lock-closed-outline"
              size={14}
              color={colors.textMuted}
            />
            <Text
              style={[styles.securityNoteText, { color: colors.textMuted }]}
            >
              Your data is encrypted and used only for verification purposes.
            </Text>
          </View>
        </AppKeyboardContainer>
      </SafeAreaView>
    </>
  );
}
