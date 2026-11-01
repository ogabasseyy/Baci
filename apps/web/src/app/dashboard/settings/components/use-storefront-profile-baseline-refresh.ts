import { type MutableRefObject, useRef } from 'react';
import type { UseFormReturn } from 'react-hook-form';
import type { z } from 'zod';
import type { MerchantSettingsSnapshot } from './get-merchant-settings-snapshot';
import { refreshMerchantSettingsSnapshot } from './refresh-merchant-settings-snapshot';
import type { SettingsFormValues, settingsSchema } from './settings-utils';

const profileFields = [
  'business_name',
  'country',
  'phone',
  'site_description',
  'support_email',
  'support_phone',
] as const;

type StorefrontProfileForm = Pick<
  UseFormReturn<z.input<typeof settingsSchema>, unknown, SettingsFormValues>,
  'getValues' | 'reset' | 'setValue'
>;

export type StorefrontProfileBaseline = Omit<
  MerchantSettingsSnapshot,
  'updated_at'
> & {
  updated_at: string | null | undefined;
};

interface UseStorefrontProfileBaselineRefreshInput {
  activeMerchantIdRef: MutableRefObject<string>;
  form: StorefrontProfileForm;
  profileBaselineRef: MutableRefObject<StorefrontProfileBaseline>;
}

function snapshotIsOlder(
  current: StorefrontProfileBaseline,
  candidate: MerchantSettingsSnapshot
): boolean {
  return Boolean(
    current.updated_at && candidate.updated_at < current.updated_at
  );
}

export function useStorefrontProfileBaselineRefresh({
  activeMerchantIdRef,
  form,
  profileBaselineRef,
}: UseStorefrontProfileBaselineRefreshInput) {
  const refreshGenerationRef = useRef(0);

  return async function refreshProfileBaseline(merchantId: string) {
    const refreshGeneration = ++refreshGenerationRef.current;
    const snapshot = await refreshMerchantSettingsSnapshot(merchantId);
    if (
      !snapshot ||
      refreshGeneration !== refreshGenerationRef.current ||
      activeMerchantIdRef.current !== merchantId ||
      snapshotIsOlder(profileBaselineRef.current, snapshot)
    ) {
      return;
    }

    const draft = form.getValues();
    const locallyChangedFields = profileFields.filter(
      (field) => draft[field] !== profileBaselineRef.current[field]
    );
    profileBaselineRef.current = snapshot;
    form.reset(snapshot);
    for (const field of locallyChangedFields) {
      form.setValue(field, draft[field], { shouldDirty: true });
    }
  };
}
