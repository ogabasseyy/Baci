import { z } from 'zod';

const auditEventSourceSchema = z.enum(['canonical', 'platform']);

export const adminAuditTimelineItemSchema = z.object({
  action: z.string().min(1).max(100),
  actor_kind: z.enum(['Platform admin', 'Service', 'System', 'User']),
  changed_fields: z.array(z.string().min(1).max(64)),
  event_id: z.string().uuid(),
  event_source: auditEventSourceSchema,
  occurred_at: z.string().datetime({ offset: true }),
  resource_type: z.string().min(1).max(80),
});

export const adminAuditTimelineSchema = z.array(adminAuditTimelineItemSchema);

export type AdminAuditTimelineItem = z.infer<
  typeof adminAuditTimelineItemSchema
>;
