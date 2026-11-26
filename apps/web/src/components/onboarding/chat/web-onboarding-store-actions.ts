import {
  DEFAULT_BRAND_COLORS,
  type OnboardingBrandColors,
  type OnboardingChatData,
  type OnboardingChatMessage,
} from '@baci/shared/onboarding-chat';
import type { User } from '@supabase/supabase-js';
import { submitOnboarding } from '@/app/(platform)/onboarding/actions';
import {
  trackMerchantSignupCompleted,
  trackMerchantSignupStarted,
} from '@/components/analytics/platform-analytics-provider';
import {
  getWebBusinessTypeLabel,
  requestWebOnboardingAssist,
  uploadWebDataUriLogo,
  uploadWebOnboardingLogo,
  type WebChatStep,
} from './web-onboarding-chat-helpers';

export interface LogoDraft {
  uri: string;
  colors: OnboardingBrandColors;
  source: 'uploaded' | 'generated';
}

export interface StoreActionContext {
  user: User | null;
  data: OnboardingChatData;
  setData: React.Dispatch<React.SetStateAction<OnboardingChatData>>;
  setStep: (step: WebChatStep) => void;
  setSuggestedNames: (names: string[]) => void;
  setLogoDraft: (draft: LogoDraft | null) => void;
  setRejectedSlug: (slug: string | null) => void;
  setIsCustomizingSlug: (customizing: boolean) => void;
  setIsBusy: (busy: boolean) => void;
  setIsLaunching: (launching: boolean) => void;
  appendMessages: (...items: Omit<OnboardingChatMessage, 'id'>[]) => void;
}

export async function runWebNameSuggestion(
  description: string,
  ctx: StoreActionContext
): Promise<void> {
  ctx.appendMessages({ role: 'user', text: description });
  ctx.setIsBusy(true);
  try {
    const result = await requestWebOnboardingAssist({
      task: 'generate_names',
      businessName: '',
      businessType: getWebBusinessTypeLabel(
        ctx.data.businessType,
        ctx.data.otherBusinessType
      ),
      brandPreferences: 'Modern and memorable',
      description,
      tone: 'Modern',
    });
    const names = (result.businessNames ?? [])
      .map((n) => n.trim())
      .filter(Boolean)
      .slice(0, 6);
    ctx.setSuggestedNames(names);
    ctx.appendMessages({
      role: 'assistant',
      text:
        names.length > 0
          ? 'Here are some name ideas — click one you like, or type your own below:'
          : "I couldn't brainstorm names right now. Type your favorite store name below!",
    });
  } catch {
    ctx.appendMessages({
      role: 'system',
      text: "I couldn't reach the AI naming assistant right now. You can type your store name directly below.",
    });
  } finally {
    ctx.setIsBusy(false);
    ctx.setStep('business_name');
  }
}

export async function runWebLogoFileUpload(
  file: File,
  ctx: StoreActionContext
): Promise<void> {
  if (!ctx.user) return;
  ctx.setIsBusy(true);
  try {
    const publicUrl = await uploadWebOnboardingLogo(file, ctx.user.id);
    let colors = DEFAULT_BRAND_COLORS;
    try {
      const extracted = await requestWebOnboardingAssist({
        task: 'extract_colors',
        logoUrl: publicUrl,
        businessName: ctx.data.businessName,
        businessType: ctx.data.businessType || 'other',
        brandPreferences: 'Extract from uploaded logo',
      });
      if (extracted.brandColors) colors = extracted.brandColors;
    } catch {
      // Non-blocking color extraction fallback.
    }
    ctx.setLogoDraft({ uri: publicUrl, colors, source: 'uploaded' });
    ctx.setData((prev) => ({ ...prev, brandColors: colors }));
    ctx.appendMessages(
      { role: 'user', text: `Uploaded ${file.name}` },
      {
        role: 'assistant',
        text: `Looks great! Would you like to use this logo for ${ctx.data.businessName}?`,
        logoPreviewUri: publicUrl,
        brandColors: colors,
      }
    );
  } catch (error) {
    ctx.appendMessages({
      role: 'system',
      text:
        error instanceof Error
          ? error.message
          : 'Could not upload your logo. Please try again.',
    });
  } finally {
    ctx.setIsBusy(false);
  }
}

export async function runWebLogoGeneration(
  ctx: StoreActionContext
): Promise<void> {
  ctx.appendMessages({ role: 'user', text: 'Generate a logo' });
  ctx.setIsBusy(true);
  try {
    const result = await requestWebOnboardingAssist({
      task: 'generate_logos',
      businessName: ctx.data.businessName,
      businessType:
        ctx.data.businessType === 'other' && ctx.data.otherBusinessType.trim()
          ? ctx.data.otherBusinessType.trim()
          : ctx.data.businessType,
      brandPreferences: 'Modern minimalist',
    });
    const logoUri = result.logos?.[0] ?? null;
    const colors = result.brandColors ?? DEFAULT_BRAND_COLORS;
    if (!logoUri) {
      ctx.appendMessages({
        role: 'system',
        text: "I couldn't generate a logo right now. You can try again or skip for now.",
      });
      return;
    }
    ctx.setLogoDraft({ uri: logoUri, colors, source: 'generated' });
    ctx.setData((prev) => ({ ...prev, brandColors: colors }));
    ctx.appendMessages({
      role: 'assistant',
      text: `Here's a starter logo for ${ctx.data.businessName}! What do you think?`,
      logoPreviewUri: logoUri,
      brandColors: colors,
    });
  } catch {
    ctx.appendMessages({
      role: 'system',
      text: "Logo generation isn't available right now. You can skip and add one later in Store Settings.",
    });
  } finally {
    ctx.setIsBusy(false);
  }
}

export async function runWebStoreLaunch(
  ctx: StoreActionContext
): Promise<void> {
  if (!ctx.user?.email) {
    ctx.appendMessages({
      role: 'system',
      text: 'Your session expired. Please refresh and sign in again.',
    });
    return;
  }
  ctx.setIsLaunching(true);
  ctx.setIsBusy(true);
  try {
    let persistedLogoUrl = ctx.data.logoUrl;
    if (persistedLogoUrl.startsWith('data:image/')) {
      persistedLogoUrl = await uploadWebDataUriLogo(
        persistedLogoUrl,
        ctx.user.id
      );
    }

    const formData = new FormData();
    formData.append('email', ctx.user.email);
    formData.append('firstName', ctx.data.firstName.trim());
    formData.append('lastName', ctx.data.lastName.trim());
    formData.append('phone', ctx.data.phone.trim());
    formData.append('businessName', ctx.data.businessName.trim());
    formData.append('businessType', ctx.data.businessType);
    formData.append('otherBusinessType', ctx.data.otherBusinessType.trim());
    formData.append('country', ctx.data.country);
    formData.append('slug', ctx.data.slug);
    formData.append('slugIsCustom', String(ctx.data.slugIsCustom));
    formData.append('logoUrl', persistedLogoUrl);
    formData.append('brandColors', JSON.stringify(ctx.data.brandColors));

    trackMerchantSignupStarted({
      business_name: ctx.data.businessName.trim(),
      business_type: ctx.data.businessType,
    });

    const result = await submitOnboarding(
      { message: '', success: false },
      formData
    );
    if (result.success) {
      if (result.merchantId) {
        trackMerchantSignupCompleted(result.merchantId, {
          business_name: result.businessName ?? ctx.data.businessName.trim(),
        });
      }
      window.location.href = '/dashboard';
      return;
    }
    if (result.code === 'slug_unavailable') {
      ctx.setRejectedSlug(ctx.data.slug);
      ctx.setIsCustomizingSlug(true);
      ctx.setStep('slug');
      ctx.appendMessages({
        role: 'system',
        text: `${result.message} Type another store link below:`,
      });
      return;
    }
    ctx.appendMessages({
      role: 'system',
      text: result.message || 'Could not finish store setup. Please try again.',
    });
  } catch (error) {
    ctx.appendMessages({
      role: 'system',
      text:
        error instanceof Error
          ? error.message
          : 'Could not finish store setup. Please try again.',
    });
  } finally {
    ctx.setIsLaunching(false);
    ctx.setIsBusy(false);
  }
}
