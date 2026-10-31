import type { Dispatch, SetStateAction } from 'react';
import { updateSocial } from '@/hooks/merchant/update-social';
import type { useMerchant } from '@/hooks/use-merchant-client';
import type { useToast } from '@/hooks/use-toast';
import type { HeroSlide } from '@/lib/cached-data';
import {
  getMerchantSettingsSnapshot,
  type MerchantSettingsSnapshot,
} from './get-merchant-settings-snapshot';
import { type SettingsFormValues, sanitizeSocialMedia } from './settings-utils';
import { isStorefrontProfileValueChanged } from './storefront-profile-values';
import { updateStorefrontProfile } from './update-storefront-profile';

type UpdateMerchantFn = ReturnType<typeof useMerchant>['updateMerchant'];
type ToastFn = (
  props: Parameters<ReturnType<typeof useToast>['toast']>[0]
) => unknown;
type MerchantSettingsBaseline = Omit<MerchantSettingsSnapshot, 'updated_at'> & {
  updated_at: string | null | undefined;
};

interface SaveSettingsContext {
  data: SettingsFormValues;
  heroSlides: HeroSlide[];
  heroSlidesEdited: boolean;
  merchantId: string;
  profileBaseline?: MerchantSettingsBaseline;
  socialMedia: Record<string, string> | null;
  updateMerchant: UpdateMerchantFn;
  /** Deliberately not invoked: this callback reloads the implicit merchant. */
  reloadMerchant: () => void;
  isCurrentSave: () => boolean;
  toast: ToastFn;
  setIsSaving: Dispatch<SetStateAction<boolean>>;
}

export interface SaveSettingsResult {
  error?: Error;
  heroSaved: boolean;
  profileSaved: boolean;
  snapshot?: MerchantSettingsSnapshot;
  socialSaved: boolean;
}

function getStorefrontProfilePatch(
  data: SettingsFormValues,
  profileBaseline: SaveSettingsContext['profileBaseline']
) {
  if (!profileBaseline) return null;
  const settings = {
    business_name: data.business_name,
    country: data.country,
    phone: data.phone,
    site_description: data.site_description,
    support_email: data.support_email,
    support_phone: data.support_phone,
  };
  // A field the submission did not carry is never sent: writing it would
  // clear the stored value (for example the courier pickup phone).
  const changedSettings = Object.fromEntries(
    Object.entries(settings).filter(([key, value]) =>
      isStorefrontProfileValueChanged(
        value,
        profileBaseline[key as keyof typeof settings]
      )
    )
  );

  return Object.keys(changedSettings).length > 0 ? changedSettings : null;
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function describeSavedChannels(result: SaveSettingsResult): string {
  const channels = [
    result.profileSaved ? 'storefront profile' : null,
    result.socialSaved ? 'social media' : null,
    result.heroSaved ? 'hero carousel' : null,
  ].filter((channel): channel is string => channel !== null);
  return channels.join(', ');
}

function showSaveToast({
  error,
  isCurrentSave,
  result,
  toast,
}: {
  error?: Error;
  isCurrentSave: () => boolean;
  result: SaveSettingsResult;
  toast: ToastFn;
}) {
  if (!isCurrentSave()) return;
  if (!error) {
    toast({
      title: 'Settings Saved!',
      description: 'Your store settings have been updated.',
    });
    return;
  }

  const savedChannels = describeSavedChannels(result);
  toast(
    savedChannels
      ? {
          title: 'Settings Partially Saved',
          description: `Saved your ${savedChannels}, but ${error.message}`,
          variant: 'destructive',
        }
      : {
          title: 'Error Saving Settings',
          description: error.message,
          variant: 'destructive',
        }
  );
}

export async function saveSettings({
  data,
  heroSlides,
  heroSlidesEdited,
  merchantId,
  profileBaseline,
  socialMedia,
  updateMerchant,
  isCurrentSave,
  toast,
  setIsSaving,
}: SaveSettingsContext): Promise<SaveSettingsResult> {
  const result: SaveSettingsResult = {
    heroSaved: false,
    profileSaved: false,
    socialSaved: false,
  };
  setIsSaving(true);

  try {
    const profilePatch = getStorefrontProfilePatch(data, profileBaseline);
    if (profilePatch) {
      if (!profileBaseline?.updated_at) {
        throw new Error('Store settings changed. Reload before saving again.');
      }
      await updateStorefrontProfile({
        merchantId,
        expectedUpdatedAt: profileBaseline.updated_at,
        settings: profilePatch,
      });
      result.profileSaved = true;
    }

    if (socialMedia !== null) {
      await updateSocial(merchantId, sanitizeSocialMedia(socialMedia));
      result.socialSaved = true;
    }

    if (heroSlidesEdited) {
      await updateMerchant(
        { hero_slides: heroSlides } as Parameters<UpdateMerchantFn>[0],
        { merchantId, skipReload: true }
      );
      result.heroSaved = true;
    }
  } catch (error) {
    result.error = toError(error);
  }

  if (result.profileSaved || result.socialSaved || result.heroSaved) {
    try {
      result.snapshot = await getMerchantSettingsSnapshot(merchantId);
    } catch (error) {
      result.error ??= toError(error);
    }
  }

  showSaveToast({ error: result.error, isCurrentSave, result, toast });
  if (isCurrentSave()) setIsSaving(false);
  return result;
}
