export function createDeliveryBudget(limit: number) {
  let pending = 0;
  let recorded = 0;
  return {
    reserve: (): ((wasRecorded: boolean) => void) | undefined => {
      if (pending + recorded >= limit) return undefined;
      pending += 1;
      let finished = false;
      return (wasRecorded) => {
        if (finished) return;
        finished = true;
        pending -= 1;
        if (wasRecorded) recorded += 1;
      };
    },
    recorded: () => recorded,
  };
}
