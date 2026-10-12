import { useEffect, useRef, useState } from 'react';
import { triggerHaptic } from '@/hooks/use-haptics';
import { setClipboardString } from '@/lib/clipboard';

const DEFAULT_COPY_FEEDBACK_TIMEOUT_MS = 3000;
const COPY_SUCCESS_FEEDBACK = 'Account number copied to clipboard.';
const COPY_FAILURE_FEEDBACK = 'Could not copy account number.';

type CopyToClipboardOptions = {
  failureMessage?: string;
  successMessage?: string;
  timeoutMs?: number;
};

export function useCopyToClipboard({
  failureMessage = COPY_FAILURE_FEEDBACK,
  successMessage = COPY_SUCCESS_FEEDBACK,
  timeoutMs = DEFAULT_COPY_FEEDBACK_TIMEOUT_MS,
}: CopyToClipboardOptions = {}) {
  const [feedback, setFeedback] = useState<string | null>(null);
  const isMountedRef = useRef(true);
  const feedbackTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearFeedbackTimer = () => {
    if (feedbackTimeoutRef.current) {
      clearTimeout(feedbackTimeoutRef.current);
      feedbackTimeoutRef.current = null;
    }
  };

  // Unmount-only cleanup: the timer helper only touches refs, and listing
  // it would resubscribe (and run the unmount branch) on every render.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see above
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      clearFeedbackTimer();
    };
  }, []);

  const clearFeedback = () => {
    clearFeedbackTimer();
    if (isMountedRef.current) {
      setFeedback(null);
    }
  };

  const copyToClipboard = async (value: string) => {
    const copied = await setClipboardString(value);
    if (!isMountedRef.current) {
      return copied;
    }

    if (copied) {
      triggerHaptic('success');
    }

    setFeedback(copied ? successMessage : failureMessage);
    clearFeedbackTimer();
    feedbackTimeoutRef.current = setTimeout(() => {
      if (!isMountedRef.current) {
        return;
      }
      setFeedback(null);
    }, timeoutMs);

    return copied;
  };

  return {
    clearFeedback,
    copyToClipboard,
    feedback,
  };
}
