'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2 } from 'lucide-react';
import { useEffect, useRef, useState, useTransition } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { FaviconUpload } from '@/app/dashboard/settings/favicon-upload';
import { DashboardAdUnit } from '@/components/dashboard/dashboard-ad-unit';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Form } from '@/components/ui/form';
import { useMerchant } from '@/hooks/use-merchant-client';
import { useToast } from '@/hooks/use-toast';
import type { CachedMerchant, HeroSlide } from '@/lib/cached-data';
import { logger } from '@/lib/logger';
import type { BrandColors } from '@/types';
import { BrandingCard } from './branding-card';
import { HeroCarouselCard } from './hero-carousel-card';
import { saveSettings } from './save-settings';
import { uploadLogoWithColors } from './settings-logo-upload';
import { buildSocialMediaDraft } from './settings-social-media-draft';
import {
  createSettingsSchema,
  type SettingsFormValues,
  type settingsSchema,
} from './settings-utils';
import { SocialMediaCard } from './social-media-card';
import { StoreFeaturesCard } from './store-features-card';
import { StorefrontProfileFields } from './storefront-profile-fields';
import { getStorefrontProfileValues } from './storefront-profile-values';
import {
  type StorefrontProfileBaseline,
  useStorefrontProfileBaselineRefresh,
} from './use-storefront-profile-baseline-refresh';

export interface SettingsFormProps {
  initialMerchant: CachedMerchant;
  initialBlogEnabled: boolean;
}

export function SettingsFormContents({
  initialMerchant,
  initialBlogEnabled,
}: SettingsFormProps) {
  const { toast } = useToast();
  const { reloadMerchant, updateMerchant } = useMerchant();
  const [merchantState, setMerchantState] = useState(initialMerchant);
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const saveGenerationRef = useRef(0);
  const profileDraftRevisionRef = useRef(0);
  const socialDraftRevisionRef = useRef(0);
  const heroDraftRevisionRef = useRef(0);
  const profileBaselineMerchantIdRef = useRef(initialMerchant.id);
  const [isUploading, setIsUploading] = useState(false);
  const [, startTransition] = useTransition();
  const [heroSlides, setHeroSlides] = useState<HeroSlide[]>(
    initialMerchant.hero_slides || []
  );
  const [heroSlidesEdited, setHeroSlidesEdited] = useState(false);
  const [socialMediaEdits, setSocialMediaEdits] = useState<Record<
    string,
    string
  > | null>(null);
  const profileBaselineRef = useRef<StorefrontProfileBaseline>({
    ...getStorefrontProfileValues(initialMerchant),
    updated_at: initialMerchant.updated_at,
  });
  const form = useForm<
    z.input<typeof settingsSchema>,
    unknown,
    SettingsFormValues
  >({
    // Validates against the baseline the save compares with, read at
    // validation time, so an untouched legacy phone never blocks a save.
    resolver: (values, context, options) =>
      zodResolver(createSettingsSchema(profileBaselineRef.current))(
        values,
        context,
        options
      ),
    defaultValues: getStorefrontProfileValues(initialMerchant),
  });
  const refreshProfileBaseline = useStorefrontProfileBaselineRefresh({
    activeMerchantIdRef: profileBaselineMerchantIdRef,
    form,
    profileBaselineRef,
  });
  useEffect(() => {
    return () => {
      saveGenerationRef.current += 1;
    };
  }, []);
  useEffect(() => {
    const subscription = form.watch((_values, { name }) => {
      if (name) profileDraftRevisionRef.current += 1;
    });
    return () => subscription.unsubscribe();
  }, [form]);
  const hasUnsavedDraftEdits =
    isDirty ||
    form.formState.isDirty ||
    socialMediaEdits !== null ||
    heroSlidesEdited;
  const [prevInitialMerchant, setPrevInitialMerchant] =
    useState(initialMerchant);
  const selectedMerchantChanged = initialMerchant.id !== prevInitialMerchant.id;
  if (
    initialMerchant !== prevInitialMerchant &&
    (selectedMerchantChanged || !hasUnsavedDraftEdits)
  ) {
    setPrevInitialMerchant(initialMerchant);
    setMerchantState(initialMerchant);
    setIsDirty(false);
    setHeroSlides(initialMerchant.hero_slides || []);
    setHeroSlidesEdited(false);
    setSocialMediaEdits(null);
    profileDraftRevisionRef.current = 0;
    socialDraftRevisionRef.current = 0;
    heroDraftRevisionRef.current = 0;
    profileBaselineMerchantIdRef.current = initialMerchant.id;
    profileBaselineRef.current = {
      ...getStorefrontProfileValues(initialMerchant),
      updated_at: initialMerchant.updated_at,
    };
    form.reset(getStorefrontProfileValues(initialMerchant));
  }
  const handleLogoUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => {
      void uploadLogoWithColors({
        dataUri: reader.result as string,
        merchantId: initialMerchant.id,
        previousState: merchantState,
        updateMerchant,
        toast,
        setMerchantState,
        setIsUploading,
        startTransition,
        onMerchantMutationSaved: refreshProfileBaseline,
      });
    };
    reader.readAsDataURL(file);
  };
  const saveColors = async (colors: BrandColors) => {
    startTransition(() => {
      setMerchantState((previous) =>
        previous ? { ...previous, brand_colors: colors } : previous
      );
    });
    setIsDirty(true);
    try {
      await updateMerchant(
        { brand_colors: colors },
        { merchantId: initialMerchant.id, skipReload: true }
      );
      await refreshProfileBaseline(initialMerchant.id);
      setIsDirty(false);
    } catch (error) {
      logger.error({ error: error as Error, message: 'Color update failed' });
      toast({
        title: 'Color Update Failed',
        description: 'Could not save color changes.',
        variant: 'destructive',
      });
    }
  };
  const handleColorChange = (role: keyof BrandColors, newColor: string) => {
    if (!merchantState.brand_colors) return;
    void saveColors({ ...merchantState.brand_colors, [role]: newColor });
  };
  const handleShuffleColors = () => {
    if (!merchantState.brand_colors) return;
    const { primary, background, accent } = merchantState.brand_colors;
    void saveColors({
      primary: accent,
      background: primary,
      accent: background,
    });
  };
  async function onSubmit(data: SettingsFormValues) {
    const saveGeneration = ++saveGenerationRef.current;
    const profileDraftRevision = profileDraftRevisionRef.current;
    const socialDraftRevision = socialDraftRevisionRef.current;
    const heroDraftRevision = heroDraftRevisionRef.current;
    const result = await saveSettings({
      data,
      heroSlides,
      heroSlidesEdited,
      merchantId: initialMerchant.id,
      profileBaseline: profileBaselineRef.current,
      socialMedia: socialMediaEdits,
      updateMerchant,
      reloadMerchant,
      isCurrentSave: () => saveGeneration === saveGenerationRef.current,
      toast,
      setIsSaving,
    });
    if (result.snapshot && saveGeneration === saveGenerationRef.current) {
      profileBaselineRef.current = result.snapshot;
      if (
        result.heroSaved &&
        heroDraftRevision === heroDraftRevisionRef.current
      ) {
        setHeroSlidesEdited(false);
      }
      if (
        result.socialSaved &&
        socialDraftRevision === socialDraftRevisionRef.current
      ) {
        setSocialMediaEdits(null);
      }
      if (profileDraftRevision === profileDraftRevisionRef.current) {
        form.reset(result.snapshot);
      }
    }
  }
  return (
    <Form {...form}>
      <form
        onSubmit={(event) => {
          void form.handleSubmit(onSubmit)(event);
        }}
        className="grid gap-6"
      >
        <BrandingCard
          merchantState={merchantState}
          brandColors={merchantState.brand_colors ?? undefined}
          isUploading={isUploading}
          onLogoUpload={handleLogoUpload}
          onColorChange={handleColorChange}
          onShuffleColors={handleShuffleColors}
        />
        <StoreFeaturesCard
          initialBlogEnabled={initialBlogEnabled}
          merchantId={merchantState.id}
        />
        <StorefrontProfileFields form={form} />
        <Card className="glass">
          <CardHeader>
            <CardTitle>Favicon</CardTitle>
            <CardDescription>
              Upload a custom favicon for your storefront browser tabs and
              bookmarks.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FaviconUpload
              merchantId={initialMerchant.id}
              onMerchantMutationSaved={refreshProfileBaseline}
            />
          </CardContent>
        </Card>
        <DashboardAdUnit variant="horizontal" />
        <HeroCarouselCard
          slides={heroSlides}
          onSlidesChange={(slides) => {
            heroDraftRevisionRef.current += 1;
            setHeroSlides(slides);
            setHeroSlidesEdited(true);
          }}
        />
        <SocialMediaCard
          initialSocialMedia={buildSocialMediaDraft(initialMerchant)}
          merchantId={initialMerchant.id}
          onMerchantMutationSaved={refreshProfileBaseline}
          onSocialMediaChange={(socialMedia) => {
            socialDraftRevisionRef.current += 1;
            setSocialMediaEdits(socialMedia);
          }}
        />
        <div className="flex justify-end">
          <Button type="submit" disabled={isSaving}>
            {isSaving && (
              <Loader2 className="mr-2 size-4 motion-safe:animate-spin" />
            )}
            Save Changes
          </Button>
        </div>
      </form>
    </Form>
  );
}
