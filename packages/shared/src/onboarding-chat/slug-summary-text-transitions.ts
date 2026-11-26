import {
  exchangeMessages,
  summaryRecapMessages,
  type TransitionResult,
} from './transitions';
import { isValidStoreSlug, sanitizeSlugInput } from './types';

export function transitionFromSlugText(
  trimmed: string,
  lower: string,
  currentSlug: string,
  isCustomizingSlug: boolean
): TransitionResult {
  const normalizedConfirm = lower.replace(/[.!?]+$/, '').trim();
  if (
    !isCustomizingSlug &&
    /^(yes|looks good|ok|confirm)$/.test(normalizedConfirm)
  ) {
    return {
      nextStep: 'summary',
      customizingSlug: false,
      messages: summaryRecapMessages(`Use ${currentSlug}.usebaci.com`),
    };
  }
  if (!isCustomizingSlug) {
    const isConversationalRejection =
      /\s/.test(trimmed) ||
      /^(no|nah|nope|change|custom|customize|edit|different|don't|dont)\b/.test(
        lower
      );
    if (!isConversationalRejection) {
      const directSlug = sanitizeSlugInput(trimmed);
      if (isValidStoreSlug(directSlug)) {
        return {
          nextData: { slug: directSlug, slugIsCustom: true },
          nextStep: 'summary',
          customizingSlug: false,
          messages: summaryRecapMessages(`${directSlug}.usebaci.com`),
        };
      }
      return {
        customizingSlug: true,
        messages: exchangeMessages(
          trimmed,
          'Store links must be 3–63 characters using lowercase letters, numbers, and hyphens (for example, "kicks-hub").'
        ),
      };
    }
    return {
      customizingSlug: true,
      messages: exchangeMessages(
        trimmed,
        'No problem! Type the store link handle you want (letters, numbers, and hyphens):'
      ),
    };
  }
  const cleaned = sanitizeSlugInput(trimmed);
  if (!isValidStoreSlug(cleaned)) {
    return {
      messages: exchangeMessages(
        trimmed,
        'Store links must be 3–63 characters using lowercase letters, numbers, and hyphens (for example, "kicks-hub").'
      ),
    };
  }
  return {
    nextData: { slug: cleaned, slugIsCustom: true },
    nextStep: 'summary',
    customizingSlug: false,
    messages: summaryRecapMessages(`${cleaned}.usebaci.com`),
  };
}

export function transitionFromSummaryText(
  trimmed: string,
  lower: string
): TransitionResult {
  const normalizedSummary = lower.replace(/[!.\s]+$/g, '');
  if (
    /^(?:yes(?:\s*,)?\s*)?(?:launch(?:\s+(?:my\s+store|store|it|now))?|yes)$/.test(
      normalizedSummary
    )
  ) {
    return { sideEffect: { type: 'launch_store' } };
  }
  return {
    messages: exchangeMessages(
      trimmed,
      'Tap "Launch my store" to finish, or use "Change link", "Change store name", "Change phone", or "Start over" below.'
    ),
  };
}
