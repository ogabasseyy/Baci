import type { User } from '@supabase/supabase-js';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert, View } from 'react-native';
import type { BusinessTypeId } from '@/constants/business-types';
import { useAuth } from '@/hooks/useAuth';
import { useMerchantProvisioning } from '@/hooks/useMerchantProvisioning';
import { useTheme } from '@/hooks/useTheme';
import { getMerchantProvisioningError } from '@/lib/merchant-provisioning-error';
import { MerchantSetupOwnerStep } from './MerchantSetupOwnerStep';
import { MerchantSetupProgress } from './MerchantSetupProgress';
import { RegisterBusinessStep } from './RegisterBusinessStep';
import { getStyles } from './register.styles';
import { requiresOwnerNameFields } from './requires-owner-name-fields';

interface MerchantSetupFormData {
  firstName: string;
  lastName: string;
  phone: string;
  businessName: string;
  businessType: string;
  country: string;
  otherBusinessType: string;
  slug: string;
  logoUrl: string;
}

interface OwnerNames {
  firstName: string;
  lastName: string;
}

function metadataString(user: User, key: string): string {
  const value = user.user_metadata?.[key];
  return typeof value === 'string' ? value.trim() : '';
}

function ownerNamesFromMetadata(user: User): OwnerNames {
  const fullName =
    metadataString(user, 'full_name') || metadataString(user, 'name');
  const nameParts = fullName.split(/\s+/).filter(Boolean);
  const firstName = metadataString(user, 'first_name') || nameParts[0] || '';
  const lastName =
    metadataString(user, 'last_name') || nameParts.slice(1).join(' ');

  return { firstName, lastName };
}

function initialFormData(user: User): MerchantSetupFormData {
  const { firstName, lastName } = ownerNamesFromMetadata(user);
  const businessName = firstName ? `${firstName}'s Store` : '';
  const slug = businessName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');

  return {
    firstName,
    lastName,
    phone: '',
    businessName,
    businessType: '',
    country: 'NG',
    otherBusinessType: '',
    slug,
    logoUrl:
      metadataString(user, 'avatar_url') || metadataString(user, 'picture'),
  };
}

export function MerchantSetupForm() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const { user, signOut } = useAuth();
  const provisionMerchant = useMerchantProvisioning();
  const [formData, setFormData] = useState<MerchantSetupFormData>(() =>
    user
      ? initialFormData(user)
      : initialFormData({ user_metadata: {} } as User)
  );
  const [isSlugEdited, setIsSlugEdited] = useState(false);
  const [slugError, setSlugError] = useState<string | null>(null);
  const [setupStep, setSetupStep] = useState<1 | 2>(1);
  const [collectOwnerNames, setCollectOwnerNames] = useState(() =>
    user ? requiresOwnerNameFields(formData.firstName, formData.lastName) : true
  );
  const hydratedUserId = useRef<string | null>(user?.id ?? null);

  useEffect(() => {
    if (!user) {
      hydratedUserId.current = null;
      return;
    }
    const defaults = initialFormData(user);
    const wasUnauthenticated = hydratedUserId.current === null;
    const userChanged =
      hydratedUserId.current !== null && hydratedUserId.current !== user.id;
    hydratedUserId.current = user.id;
    if (userChanged) {
      setFormData(defaults);
      setCollectOwnerNames(
        requiresOwnerNameFields(defaults.firstName, defaults.lastName)
      );
      setSetupStep(1);
      setIsSlugEdited(false);
      setSlugError(null);
      return;
    }
    if (wasUnauthenticated) {
      setCollectOwnerNames(
        requiresOwnerNameFields(defaults.firstName, defaults.lastName)
      );
      setSetupStep(1);
    }
    setFormData((previous) =>
      previous.firstName && previous.lastName
        ? previous
        : {
            ...previous,
            firstName: previous.firstName || defaults.firstName,
            lastName: previous.lastName || defaults.lastName,
            businessName: previous.businessName || defaults.businessName,
            slug: previous.slug || defaults.slug,
            logoUrl: previous.logoUrl || defaults.logoUrl,
          }
    );
  }, [user]);

  if (!user) {
    return null;
  }

  const requiresOwnerDetails = collectOwnerNames;

  const continueToBusinessInfo = () => {
    if (requiresOwnerNameFields(formData.firstName, formData.lastName)) {
      Alert.alert(
        'Check Your Details',
        'Please enter your first and last name.'
      );
      return;
    }
    setSetupStep(2);
  };

  const updateForm = <K extends keyof MerchantSetupFormData>(
    key: K,
    value: MerchantSetupFormData[K]
  ) => {
    setFormData((previous) => {
      const updates: Partial<MerchantSetupFormData> = { [key]: value };
      if (key === 'businessName' && !isSlugEdited) {
        updates.slug = value
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/(^-|-$)/g, '');
      }
      if (key === 'businessType' && value !== 'other') {
        updates.otherBusinessType = '';
      }
      return { ...previous, ...updates };
    });
  };

  const reauthenticate = async () => {
    await signOut();
    router.replace('/(auth)/login');
  };

  const showIdentityIncomplete = () => {
    Alert.alert(
      'Sign In Again',
      'Your authenticated account is missing required identity data. Please sign in again.',
      [
        {
          text: 'Sign In Again',
          onPress: () => {
            void reauthenticate();
          },
        },
        { text: 'Cancel', style: 'cancel' },
      ]
    );
  };

  const handleLaunchStore = async () => {
    setSlugError(null);
    if (
      !formData.firstName.trim() ||
      !formData.lastName.trim() ||
      !formData.businessName.trim() ||
      !formData.businessType.trim()
    ) {
      Alert.alert(
        'Check Your Details',
        'Please enter your first name, last name, business name, and business type.'
      );
      return;
    }
    if (
      formData.businessType === 'other' &&
      !formData.otherBusinessType.trim()
    ) {
      Alert.alert('Check Your Details', 'Please specify your business type.');
      return;
    }
    if (!user.email) {
      showIdentityIncomplete();
      return;
    }

    try {
      await provisionMerchant.mutateAsync({
        firstName: formData.firstName.trim(),
        lastName: formData.lastName.trim(),
        phone: formData.phone.trim() || undefined,
        businessName: formData.businessName.trim(),
        businessType: formData.businessType,
        otherBusinessType: formData.otherBusinessType.trim() || undefined,
        country: formData.country,
        slug: formData.slug || undefined,
        slugIsCustom: isSlugEdited,
        logoUrl: formData.logoUrl || undefined,
        brandColors: {
          primary: '#000000',
          background: '#ffffff',
          accent: '#f59e0b',
        },
      });
      router.replace('/(admin)/(tabs)');
    } catch (error) {
      const provisioningError = getMerchantProvisioningError(error);
      if (provisioningError.code === 'slug_unavailable') {
        setSlugError(provisioningError.message);
        Alert.alert('Store Link Unavailable', provisioningError.message);
        return;
      }
      if (provisioningError.code === 'identity_incomplete') {
        showIdentityIncomplete();
        return;
      }
      Alert.alert('Setup Failed', provisioningError.message);
    }
  };

  return (
    <View style={styles.formSection}>
      <MerchantSetupProgress
        onAboutYouPress={() => setSetupStep(1)}
        step={setupStep}
      />
      {setupStep === 1 ? (
        <MerchantSetupOwnerStep
          country={formData.country}
          firstName={formData.firstName}
          lastName={formData.lastName}
          onContinue={continueToBusinessInfo}
          onCountryChange={(value) => updateForm('country', value)}
          onFirstNameChange={(value) => updateForm('firstName', value)}
          onLastNameChange={(value) => updateForm('lastName', value)}
          onPhoneChange={(value) => updateForm('phone', value)}
          phone={formData.phone}
          showNameFields={requiresOwnerDetails}
        />
      ) : null}
      {setupStep === 2 ? (
        <RegisterBusinessStep
          firstName={formData.firstName}
          formData={formData}
          isLoading={provisionMerchant.isPending}
          onBack={() => setSetupStep(1)}
          onBusinessNameChange={(value) => updateForm('businessName', value)}
          onBusinessTypeChange={(value: BusinessTypeId) =>
            updateForm('businessType', value)
          }
          onLaunchStore={handleLaunchStore}
          onOtherBusinessTypeChange={(value) =>
            updateForm('otherBusinessType', value)
          }
          onSlugChange={(value) => {
            setIsSlugEdited(true);
            setSlugError(null);
            updateForm('slug', value.toLowerCase().replace(/[^a-z0-9-]/g, ''));
          }}
          slugError={slugError}
        />
      ) : null}
    </View>
  );
}
