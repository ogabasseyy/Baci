import { useEffect, useRef, useState } from 'react';
import { triggerHaptic } from '@/hooks/use-haptics';

export type SavingsCelebration = { added: number; percent: number };

/**
 * Watches a finished contribution: when the saved amount grew between the
 * moment adding started and the moment it finished, returns what was added so
 * the sheet can celebrate it. Reads state only; it never starts or retries a
 * contribution.
 */
export function useSavingsCelebration({
  currentAmount,
  goalId,
  isAdding,
  targetAmount,
  visible,
}: {
  currentAmount: number;
  goalId: string;
  isAdding: boolean;
  targetAmount: number;
  visible: boolean;
}) {
  const activeGoal = useRef(goalId);
  const startAmount = useRef<number | null>(null);
  const [celebration, setCelebration] = useState<SavingsCelebration | null>(
    null
  );

  useEffect(() => {
    if (activeGoal.current !== goalId) {
      activeGoal.current = goalId;
      startAmount.current = null;
      setCelebration(null);
    }
    if (!visible || !goalId) {
      startAmount.current = null;
      setCelebration(null);
      return;
    }
    if (isAdding) {
      startAmount.current ??= currentAmount;
      setCelebration(null);
      return;
    }
    if (startAmount.current === null) return;
    const added = currentAmount - startAmount.current;
    startAmount.current = null;
    if (added > 0) {
      const percent =
        targetAmount > 0
          ? Math.min(100, Math.floor((currentAmount * 100) / targetAmount))
          : 0;
      setCelebration({ added, percent });
      triggerHaptic('success');
    }
  }, [currentAmount, goalId, isAdding, targetAmount, visible]);

  return celebration;
}
