import { normalizeCacSearchTerm, parseCacRegistration } from '@baci/shared';
import Ionicons from '@react-native-vector-icons/ionicons';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { useTheme } from '@/hooks/useTheme';
import { apiClient, apiFormData } from '@/lib/api-client';
import { tryRefreshStoreReadiness } from '@/lib/try-refresh-store-readiness';
import { createUploadFormData } from '@/lib/upload/createUploadFormData';
import CacResultStep from './CacResultStep';
import CacSearchStep from './CacSearchStep';
import CacUploadStep from './CacUploadStep';
import { styles } from './CacVerificationCard.styles';
import {
  chooseCertificateSource,
  pickCertificateFromFiles,
  pickCertificateFromGallery,
} from './cac-certificate-picker';
import {
  type CacCompany,
  type CacRegistrationPrefix,
  type CacStep,
  normalizeCacStatus,
  type SelectedCacDocument,
} from './cac-types';
import { showCacVerificationError } from './cac-verification-alerts';
import VerificationStatusBadge from './VerificationStatusBadge';

interface CacVerificationCardProps {
  cacApprovedName?: string | null;
  merchantId?: string | null;
  onVerified: () => Promise<unknown>;
  isActive?: () => boolean;
  prefillRcNumber?: string | null;
  verified: boolean;
}

export default function CacVerificationCard({
  verified,
  prefillRcNumber,
  cacApprovedName,
  merchantId,
  onVerified,
  isActive = () => true,
}: CacVerificationCardProps) {
  const { colors, shadows } = useTheme();
  const [expanded, setExpanded] = useState(false);
  const [cacStep, setCacStep] = useState<CacStep>('search');
  const [registrationPrefix, setRegistrationPrefix] =
    useState<CacRegistrationPrefix>('RC');
  const [rcNumber, setRcNumber] = useState('');
  const [selectedCompany, setSelectedCompany] = useState<CacCompany | null>(
    null
  );
  const [selectedDocument, setSelectedDocument] =
    useState<SelectedCacDocument | null>(null);
  const [verifyResult, setVerifyResult] = useState<{
    verified: boolean;
    reason?: string;
  } | null>(null);

  const [prevPrefillRcNumber, setPrevPrefillRcNumber] = useState<
    string | null | undefined
  >(undefined);

  if (prefillRcNumber !== prevPrefillRcNumber) {
    setPrevPrefillRcNumber(prefillRcNumber);
    const parsedRegistration = parseCacRegistration(prefillRcNumber);

    if (parsedRegistration?.prefix) {
      setRegistrationPrefix(parsedRegistration.prefix);
      setRcNumber(parsedRegistration.digits);
    } else {
      setRegistrationPrefix('RC');
      setRcNumber(parsedRegistration?.digits ?? '');
    }
  }

  const searchMutation = useMutation({
    mutationFn: async () => {
      const response = await apiClient<{
        companies: Array<{
          approvedName: string;
          rcNumber: string;
          status: unknown;
        }>;
      }>('/api/merchant/cac-search', {
        method: 'POST',
        body: JSON.stringify({
          searchTerm: normalizeCacSearchTerm(rcNumber, registrationPrefix),
        }),
      });
      const companies: CacCompany[] = response.companies.map((c) => ({
        approvedName: c.approvedName,
        rcNumber: c.rcNumber,
        status: normalizeCacStatus(c.status),
      }));
      return { companies };
    },
    onSuccess: ({ companies }) => {
      if (companies.length === 1 && isActive()) {
        setSelectedCompany(companies[0]);
        setCacStep('upload');
      } else if (isActive()) {
        setSelectedCompany(null);
        setCacStep('search');
      }
    },
    onError: (error: unknown) => isActive() && showCacVerificationError(error),
  });

  const uploadMutation = useMutation({
    mutationFn: async () => {
      if (!selectedCompany) {
        throw new Error('Missing selected company for upload.');
      }
      if (!selectedDocument) {
        throw new Error('Missing certificate file for upload.');
      }
      const subtype = selectedDocument.mimeType.split('/')[1] || 'jpeg';
      const ext = subtype === 'jpeg' ? 'jpg' : subtype;
      const formData = await createUploadFormData({
        uri: selectedDocument.uri,
        name: selectedDocument.name || `cac-certificate.${ext}`,
        type: selectedDocument.mimeType,
      });
      formData.append('rcNumber', selectedCompany.rcNumber);
      formData.append('approvedName', selectedCompany.approvedName);
      formData.append('merchantId', merchantId ?? '');
      return apiFormData<{ verified: boolean; reason?: string }>(
        '/api/merchant/verify-cac',
        formData
      );
    },
    onSuccess: async (data) => {
      if (isActive()) setVerifyResult(data);
      if (isActive()) setCacStep('result');
      const readinessRefreshed = data.verified
        ? await tryRefreshStoreReadiness(onVerified)
        : true;
      if (!isActive()) return;

      if (data.verified && !readinessRefreshed) {
        Alert.alert(
          'Verified',
          'Your CAC has been verified. Your setup status will refresh shortly.'
        );
      }
    },
    onError: (error: unknown) => isActive() && showCacVerificationError(error),
  });

  function handleSearch() {
    if (!rcNumber.trim()) return;
    searchMutation.mutate();
  }

  function handleSelectCompany(company: CacCompany) {
    setSelectedCompany(company);
    setCacStep('upload');
  }

  async function handlePickDocument() {
    try {
      const source = await chooseCertificateSource();
      if (!source) return;
      const document =
        source === 'gallery'
          ? await pickCertificateFromGallery()
          : await pickCertificateFromFiles();

      if (document) {
        setSelectedDocument(document);
      }
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Unable to access your selected certificate source. Please try again.';
      Alert.alert('Error', message);
    }
  }

  function handleTryAgain() {
    setVerifyResult(null);
    setSelectedCompany(null);
    setSelectedDocument(null);
    setCacStep('search');
  }

  if (verified) {
    return (
      <View
        style={[
          styles.card,
          { backgroundColor: colors.card, borderColor: colors.border },
          shadows.sm,
        ]}
      >
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Ionicons
              accessibilityLabel="Business verification icon"
              color={colors.primary}
              name="business-outline"
              size={22}
            />
            <Text style={[styles.title, { color: colors.text }]}>
              Business Verification
            </Text>
          </View>
          <VerificationStatusBadge status="verified" />
        </View>
        {cacApprovedName ? (
          <Text style={[styles.approvedName, { color: colors.success }]}>
            {cacApprovedName}
          </Text>
        ) : null}
      </View>
    );
  }

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: colors.card, borderColor: colors.border },
        shadows.sm,
      ]}
    >
      <Pressable
        style={styles.header}
        onPress={() => setExpanded((prev) => !prev)}
        accessibilityRole="button"
        accessibilityLabel="Toggle Business Verification section"
      >
        <View style={styles.headerLeft}>
          <Ionicons
            accessibilityLabel="Business verification icon"
            color={colors.primary}
            name="business-outline"
            size={22}
          />
          <Text style={[styles.title, { color: colors.text }]}>
            Business Verification
          </Text>
          <VerificationStatusBadge status="not-started" />
        </View>
        <Ionicons
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={20}
          color={colors.textSecondary}
        />
      </Pressable>

      {expanded && (
        <View style={styles.body}>
          {cacStep === 'search' && (
            <CacSearchStep
              registrationPrefix={registrationPrefix}
              onChangeRegistrationPrefix={setRegistrationPrefix}
              rcNumber={rcNumber}
              onChangeRcNumber={setRcNumber}
              onSearch={handleSearch}
              isSearching={searchMutation.isPending}
              results={searchMutation.data?.companies}
              onSelect={handleSelectCompany}
            />
          )}
          {cacStep === 'upload' && selectedCompany && (
            <CacUploadStep
              company={selectedCompany}
              document={selectedDocument}
              onBack={() => {
                setSelectedDocument(null);
                setCacStep('search');
              }}
              onPickDocument={handlePickDocument}
              onVerify={() => {
                if (selectedDocument) uploadMutation.mutate();
              }}
              isUploading={uploadMutation.isPending}
            />
          )}
          {cacStep === 'result' && verifyResult && (
            <CacResultStep
              verified={verifyResult.verified}
              reason={verifyResult.reason}
              onTryAgain={handleTryAgain}
            />
          )}
        </View>
      )}
    </View>
  );
}
