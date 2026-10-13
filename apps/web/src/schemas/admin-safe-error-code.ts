import { z } from 'zod';

export const adminSafeErrorCodes = [
  'analytics_config_unavailable',
  'batch_partial_failure',
  'destination_not_configured',
  'domain_event_message_failed',
  'domain_event_message_invalid',
  'domain_event_read_failed',
  'domain_event_read_invalid',
  'domain_event_route_failed',
  'event_delivery_claim_failed',
  'ingress_dead_letter_failed',
  'invalid_destination_credentials',
  'invalid_destination_payload',
  'invalid_event_envelope',
  'invalid_payload',
  'max_attempts_exceeded',
  'missing_immutable_data',
  'paid_order_lookup_failed',
  'paid_order_not_deliverable',
  'provider_failure',
  'provider_rejected',
  'provider_request_timeout',
  'routing_attempts_exhausted',
  'timeout',
  'unclassified_error',
  'unsupported_event',
] as const;

export const adminSafeErrorCodeSchema = z.enum(adminSafeErrorCodes);
export const nullableAdminSafeErrorCodeSchema =
  adminSafeErrorCodeSchema.nullable();
