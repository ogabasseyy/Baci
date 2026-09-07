import type { Dispatch, SetStateAction } from 'react';
import { Alert } from 'react-native';
import type { CountryCode } from 'react-native-country-picker-modal';
import { createEmptyNewCustomerDraft } from '@/components/orders/new-order.defaults';
import {
  type CustomerType,
  DEFAULT_COUNTRY_CODE,
  getCustomerDisplayName,
} from '@/components/orders/new-order.shared';
import type {
  CustomerInfo,
  NewCustomerDraft,
  SelectableCustomer,
} from '@/components/orders/new-order.types';
import {
  sanitizeAddress,
  sanitizeCustomerName,
  sanitizeEmail,
  sanitizePhone,
} from '@/lib/sanitize';
import { supabase } from '@/lib/supabase';

interface CreateNewOrderCustomerActionsParams {
  createCustomer: (input: {
    address?: string;
    company_name?: string;
    customer_type: CustomerType;
    email?: string;
    first_name: string;
    last_name: string;
    phone: string;
    city?: string;
    state?: string;
    zip_code?: string;
    country?: string;
    country_code?: string;
    latitude?: number;
    longitude?: number;
  }) => Promise<SelectableCustomer>;
  merchantId?: string;
  newCustomer: NewCustomerDraft;
  setCustomer: Dispatch<SetStateAction<CustomerInfo>>;
  setCustomerSearch: Dispatch<SetStateAction<string>>;
  setDuplicateCustomer: Dispatch<SetStateAction<SelectableCustomer | null>>;
  setIsCreatingCustomer: Dispatch<SetStateAction<boolean>>;
  setNewCustomer: Dispatch<SetStateAction<NewCustomerDraft>>;
  setSelectedCountryCode: Dispatch<SetStateAction<CountryCode>>;
  setShowCustomerModal: Dispatch<SetStateAction<boolean>>;
}

// Escape LIKE/ILIKE wildcards so an email/value with `_` or `%` (both valid in
// email local parts) is matched literally instead of as a pattern.
function escapeIlikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

function normalizeNewCustomerDraft(newCustomer: NewCustomerDraft) {
  return {
    address: newCustomer.address ? sanitizeAddress(newCustomer.address) : '',
    companyName: sanitizeCustomerName(newCustomer.companyName),
    customerType: newCustomer.customerType,
    email: newCustomer.email ? sanitizeEmail(newCustomer.email) : '',
    firstName: sanitizeCustomerName(newCustomer.firstName),
    lastName: sanitizeCustomerName(newCustomer.lastName),
    phone: newCustomer.phone ? sanitizePhone(newCustomer.phone) : '',
    city: newCustomer.city?.trim() ?? '',
    state: newCustomer.state?.trim() ?? '',
    country: newCustomer.country?.trim() ?? '',
    countryCode: newCustomer.countryCode?.trim() ?? '',
    postalCode: newCustomer.postalCode?.trim() ?? '',
    latitude: newCustomer.latitude,
    longitude: newCustomer.longitude,
  };
}

export function createNewOrderCustomerActions({
  createCustomer,
  merchantId,
  newCustomer,
  setCustomer,
  setCustomerSearch,
  setDuplicateCustomer,
  setIsCreatingCustomer,
  setNewCustomer,
  setSelectedCountryCode,
  setShowCustomerModal,
}: CreateNewOrderCustomerActionsParams) {
  const resetNewCustomerForm = () => {
    setNewCustomer(createEmptyNewCustomerDraft());
  };

  const handleCloseCustomerModal = () => {
    setShowCustomerModal(false);
    setIsCreatingCustomer(false);
    // Keep the in-progress new-customer draft (name/phone/email/address +
    // country) so dismissing the sheet doesn't discard typed input — it's reset
    // only after a successful create. Clear just the transient duplicate/search
    // state that shouldn't survive a reopen.
    setDuplicateCustomer(null);
    setCustomerSearch('');
  };

  const handleSelectCustomer = (item: SelectableCustomer) => {
    setCustomer({
      address: item.address || '',
      email: item.email || '',
      id: item.id,
      name: getCustomerDisplayName(item),
      phone: item.phone || '',
      city: item.city || '',
      state: item.state || '',
      country: item.country || '',
      countryCode: item.country_code || '',
      postalCode: item.zip_code || '',
      latitude: item.latitude ?? undefined,
      longitude: item.longitude ?? undefined,
    });
    setShowCustomerModal(false);
    setCustomerSearch('');
  };

  const handleCreateCustomer = async () => {
    const normalizedCustomer = normalizeNewCustomerDraft(newCustomer);
    const isCompany = normalizedCustomer.customerType === 'company';

    if (isCompany) {
      if (!normalizedCustomer.companyName || !normalizedCustomer.phone) {
        Alert.alert('Required', 'Company Name and Phone are required');
        return;
      }
    } else if (!normalizedCustomer.firstName || !normalizedCustomer.phone) {
      Alert.alert('Required', 'First Name and Phone are required');
      return;
    }

    if (!merchantId) {
      Alert.alert(
        'Unavailable',
        'Merchant information is still loading. Please try again.'
      );
      return;
    }

    try {
      const duplicateChecks = [
        {
          column: 'phone' as const,
          match: 'eq' as const,
          value: normalizedCustomer.phone,
        },
        {
          column: 'email' as const,
          match: 'ilike' as const,
          value: normalizedCustomer.email,
        },
      ];

      for (const { column, match, value } of duplicateChecks) {
        if (!value) {
          continue;
        }

        let query = supabase
          .from('customers')
          .select(
            'id, customer_type, company_name, full_name, first_name, last_name, email, phone, address, city, state, zip_code, country, country_code, latitude, longitude'
          )
          .eq('merchant_id', merchantId)
          .is('deleted_at', null);

        query =
          match === 'ilike'
            ? query.ilike(column, escapeIlikePattern(value))
            : query.eq(column, value);

        const { data: existingCustomer, error: searchError } =
          await query.limit(1);

        if (searchError) {
          Alert.alert(
            'Error',
            'Unable to check for existing customers right now.'
          );
          return;
        }

        const firstMatch = existingCustomer?.[0] ?? null;

        if (firstMatch) {
          setDuplicateCustomer(firstMatch);
          return;
        }
      }

      const customer = await createCustomer({
        address: normalizedCustomer.address || undefined,
        company_name: isCompany
          ? normalizedCustomer.companyName || undefined
          : undefined,
        customer_type: normalizedCustomer.customerType,
        email: normalizedCustomer.email || undefined,
        first_name: isCompany ? '' : normalizedCustomer.firstName,
        last_name: isCompany ? '' : normalizedCustomer.lastName,
        phone: normalizedCustomer.phone,
        city: normalizedCustomer.city || undefined,
        state: normalizedCustomer.state || undefined,
        zip_code: normalizedCustomer.postalCode || undefined,
        country: normalizedCustomer.country || undefined,
        country_code: normalizedCustomer.countryCode || undefined,
        latitude: normalizedCustomer.latitude,
        longitude: normalizedCustomer.longitude,
      });

      handleSelectCustomer(customer);
      setCustomer((previous) => ({
        ...previous,
        city: normalizedCustomer.city,
        state: normalizedCustomer.state,
        country: normalizedCustomer.country,
        countryCode: normalizedCustomer.countryCode,
        postalCode: normalizedCustomer.postalCode,
        latitude: normalizedCustomer.latitude,
        longitude: normalizedCustomer.longitude,
      }));
      setIsCreatingCustomer(false);
      resetNewCustomerForm();
      setSelectedCountryCode(DEFAULT_COUNTRY_CODE);
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : 'Unable to create customer right now.';
      Alert.alert('Error', message);
    }
  };

  return {
    handleCloseCustomerModal,
    handleCreateCustomer,
    handleSelectCustomer,
    resetNewCustomerForm,
  };
}
