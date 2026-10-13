import { z } from 'zod';
import {
  platformAdminPermissions,
  platformAdminRoles,
} from '@/config/platform-admin-rbac';

export const platformAdminContextSchema = z.object({
  permissions: z.array(z.enum(platformAdminPermissions)).min(1),
  role: z.enum(platformAdminRoles),
});

export const platformAdminContextRpcSchema = z
  .array(platformAdminContextSchema)
  .max(1);

export type PlatformAdminContext = z.infer<typeof platformAdminContextSchema>;
