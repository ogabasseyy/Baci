'use client';

import { FundingDetails } from './funding-details';
import { useFundingDetails } from './use-funding-details';

export function FundingPanel({
  requestKey,
  load,
}: {
  requestKey: string | null;
  load: Parameters<typeof useFundingDetails>[1];
}) {
  const view = useFundingDetails(requestKey, load);
  return <FundingDetails {...view} />;
}
