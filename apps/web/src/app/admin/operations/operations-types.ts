import type { AdminOperationsApi } from '@/schemas/admin-operations-rpc';

export interface EventPipelineIncident {
  attempts?: number;
  destination?: string;
  event_name: string;
  failure_code?: string;
  first_failed_at?: string;
  id: string;
  last_error_code?: string | null;
  last_failed_at?: string;
  replay_count: number;
  status?: string;
  updated_at?: string;
}

interface EventPipelineDeliveryMetric {
  delivery_count: number;
  destination: string;
  oldest_age_seconds: number;
  status: string;
}

interface EventPipelineWorkerHeartbeat {
  last_error_at: string | null;
  last_error_code: string | null;
  last_started_at: string | null;
  last_succeeded_at: string | null;
  processed_count: number;
  updated_at: string;
  worker_name: string;
}

interface EventPipelineQueueMetrics {
  measured_at: string;
  newest_message_age_seconds: number | null;
  oldest_message_age_seconds: number | null;
  queue_length: number;
  total_messages: number;
}

export interface EventPipelineData {
  counts: { deliveries: number; ingress: number; unknown: number };
  deliveries: EventPipelineIncident[];
  ingress: EventPipelineIncident[];
  operations: {
    deliveries: EventPipelineDeliveryMetric[];
    heartbeats: EventPipelineWorkerHeartbeat[];
    queue: EventPipelineQueueMetrics | null;
  };
  unknown: EventPipelineIncident[];
}

export interface OperationsPageData {
  eventPipeline: OperationsSection<EventPipelineData>;
  operations: OperationsSection<AdminOperationsApi>;
}

export interface OperationsSection<T> {
  data: T | null;
  error: string | null;
}
