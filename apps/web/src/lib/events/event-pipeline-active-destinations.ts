import type { EventRouteDestination } from './event-route-destination';

const EVENT_DESTINATIONS: readonly EventRouteDestination[] = [
  'facebook',
  'ga4',
  'snapchat',
  'tiktok',
  'chatgpt',
];

export function getEventPipelineActiveDestinations(): EventRouteDestination[] {
  const requested = new Set(
    (process.env.EVENT_PIPELINE_ACTIVE_DESTINATIONS ?? '')
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean)
  );
  return EVENT_DESTINATIONS.filter((destination) => requested.has(destination));
}
