import { isLegacyAnalyticsFanoutDisabled } from '@/lib/events/legacy-analytics-fanout-disabled';
import { POST as eventsPost } from '../../../../../src/app/api/events/route';

export function POST(...args: Parameters<typeof eventsPost>) {
  if (!isLegacyAnalyticsFanoutDisabled()) {
    throw new Error('Fixture requires legacy analytics fanout to be disabled');
  }
  return eventsPost(...args);
}
