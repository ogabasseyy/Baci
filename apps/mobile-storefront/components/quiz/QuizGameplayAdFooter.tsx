import { getQuizMobileAdsConfig } from '@/config/quiz-mobile-ads';
import { useQuizMobileAds } from '@/hooks/use-quiz-mobile-ads';
import { useTheme } from '@/hooks/useTheme';
import { isAdultDateOfBirth } from '@/schemas/date-of-birth';
import { useAuthStore } from '@/stores/auth-store';
import { createQuizGameplayAdFooterStyles } from './QuizGameplayAdFooter.styles';
import { QuizGameplayAdPlacement } from './QuizGameplayAdPlacement';

interface QuizGameplayAdFooterProps {
  active: boolean;
  /** A failed pre-start warmup must not retry consent/SDK work mid-question. */
  prewarmFailed?: boolean;
}

export function QuizGameplayAdFooter({
  active,
  prewarmFailed = false,
}: QuizGameplayAdFooterProps) {
  const { colors } = useTheme();
  const dateOfBirth = useAuthStore((state) => state.customer?.date_of_birth);
  const config = getQuizMobileAdsConfig();
  const adState = useQuizMobileAds({
    ageVerified: isAdultDateOfBirth(dateOfBirth),
    config,
    requested: active && !prewarmFailed,
  });
  const styles = createQuizGameplayAdFooterStyles(colors);

  if (
    !active ||
    prewarmFailed ||
    !adState.enabled ||
    !adState.initialized ||
    !adState.canRequestAds ||
    !adState.bannerUnitId
  ) {
    return null;
  }

  return (
    <QuizGameplayAdPlacement
      bannerUnitId={adState.bannerUnitId}
      styles={styles}
    />
  );
}
