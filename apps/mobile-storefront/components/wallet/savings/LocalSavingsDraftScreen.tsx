import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, RefreshControl, Text, View } from 'react-native';
import AppKeyboardAwareScrollView from '@/components/ui/AppKeyboardAwareScrollView';
import { useColorScheme } from '@/components/useColorScheme';
import Colors, { BRAND } from '@/constants/Colors';
import { isCustomerSavingsDraftRuntimeEnabled } from '@/lib/customer-savings-draft-runtime';
import { useAuthStore } from '@/stores/auth-store';
import { LocalSavingsDraftHistory } from './LocalSavingsDraftHistory';
import { LocalSavingsDraftReview } from './LocalSavingsDraftReview';
import { StartSavingsForm } from './StartSavingsForm';
import { startSavingsStyles as styles } from './start-savings.styles';
import { readParam } from './start-savings-controller.utils';
import { useLocalSavingsDrafts } from './use-local-savings-drafts';
import { useLocalStartSavingsForm } from './use-local-start-savings-form';

export function LocalSavingsDraftScreen() {
  const userId = useAuthStore((state) => state.user?.id);
  const merchantId = useAuthStore((state) => state.merchantId);
  const params = useLocalSearchParams<{
    productId?: string;
    variantId?: string;
  }>();
  if (!isCustomerSavingsDraftRuntimeEnabled())
    return <Text>Local savings testing is unavailable.</Text>;
  if (!userId || !merchantId)
    return <Text>Please sign in to start saving.</Text>;
  const productId = readParam(params.productId);
  const variantId = readParam(params.variantId);
  return (
    <DraftJourney
      key={JSON.stringify([userId, merchantId, productId, variantId])}
      scope={{ userId, merchantId }}
      params={{ productId, variantId }}
    />
  );
}

function DraftJourney({
  scope,
  params,
}: {
  scope: { userId: string; merchantId: string };
  params: { productId?: string; variantId?: string };
}) {
  const model = useLocalSavingsDrafts(scope);
  const form = useLocalStartSavingsForm(model, params);
  const scheme = useColorScheme();
  const colors = Colors[scheme ?? 'light'];
  const draft = model.draft;
  const [searchFocused, setSearchFocused] = useState(false);
  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <AppKeyboardAwareScrollView
        bottomOffset={searchFocused ? 200 : 24}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={model.busy}
            onRefresh={() => void form.refresh()}
            tintColor={BRAND.primary}
          />
        }
      >
        {model.error && (
          <Text
            accessibilityRole="alert"
            style={[styles.errorText, { color: colors.error }]}
          >
            {model.error}
          </Text>
        )}
        {model.busy && (
          <Text
            accessibilityRole="progressbar"
            style={[styles.subheading, { color: colors.textSecondary }]}
          >
            Saving or loading your draft…
          </Text>
        )}
        {draft ? (
          <LocalSavingsDraftReview
            key={JSON.stringify([
              draft.draftId,
              draft.revisionId,
              draft.terms.hash,
              draft.terms.version,
            ])}
            draft={draft}
            colors={colors}
            busy={model.busy}
            canStartNewDraft={model.canStartNewDraft}
            onAccept={() => void model.accept()}
            onStartNew={() => void model.startNewDraft()}
            onClose={model.close}
          />
        ) : (
          <>
            <StartSavingsForm
              onSearchFocusChange={setSearchFocused}
              mode="draft"
              colors={colors}
              controller={form.controller}
            />
            {form.isLoadingSelection && (
              <Text
                style={[styles.subheading, { color: colors.textSecondary }]}
              >
                Loading exact device options…
              </Text>
            )}
            {form.catalogueError && (
              <Text
                accessibilityRole="alert"
                style={[styles.errorText, { color: colors.error }]}
              >
                Devices could not be loaded. Refresh to retry.
              </Text>
            )}
            {model.canRetryCreation && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Retry new draft"
                accessibilityState={{ disabled: model.busy }}
                disabled={model.busy}
                onPress={() => void model.retryCreation()}
                style={[styles.outlineButton, { borderColor: colors.border }]}
              >
                <Text
                  style={[styles.outlineButtonText, { color: colors.text }]}
                >
                  Retry new draft
                </Text>
              </Pressable>
            )}
            <LocalSavingsDraftHistory
              drafts={model.drafts}
              busy={model.busy}
              colors={colors}
              onOpen={(saved) => void model.open(saved)}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Refresh my drafts and devices"
              accessibilityState={{ disabled: model.busy }}
              disabled={model.busy}
              onPress={() => void form.refresh()}
              style={[styles.outlineButton, { borderColor: colors.border }]}
            >
              <Text style={[styles.outlineButtonText, { color: colors.text }]}>
                Refresh my drafts and devices
              </Text>
            </Pressable>
          </>
        )}
      </AppKeyboardAwareScrollView>
    </View>
  );
}
