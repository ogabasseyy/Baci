import { z } from 'zod';
import { platformAdminRoles } from '@/config/platform-admin-rbac';

const membershipEmailSchema = z.string().trim().toLowerCase().email().max(254);

const membershipReasonSchema = z.string().trim().min(1).max(500);

export const adminPlatformAccessUpsertSchema = z.object({
  confirmed: z.literal(true),
  email: membershipEmailSchema,
  reactivate: z.boolean().default(false),
  reason: membershipReasonSchema,
  role: z.enum(platformAdminRoles),
});

export const adminPlatformAccessRevokeSchema = z.object({
  confirmed: z.literal(true),
  email: membershipEmailSchema,
  reason: membershipReasonSchema,
});

export const adminPlatformAccessListSchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(100),
  offset: z.coerce.number().int().min(0).max(10_000).default(0),
});

const membershipTimestampSchema = z
  .string()
  .datetime({ offset: true })
  .nullable();

export const adminPlatformAccessMembershipSchema = z.object({
  created_at: membershipTimestampSchema,
  email: membershipEmailSchema,
  granted_at: membershipTimestampSchema,
  is_legacy_owner: z.boolean(),
  is_revocable: z.boolean(),
  reason: z.string().min(1).max(500),
  revoked_at: membershipTimestampSchema,
  role: z.enum(platformAdminRoles),
  status: z.enum(['active', 'revoked']),
  updated_at: membershipTimestampSchema,
});

export const adminPlatformAccessMembershipListSchema = z.array(
  adminPlatformAccessMembershipSchema
);

export type AdminPlatformAccessMembership = z.infer<
  typeof adminPlatformAccessMembershipSchema
>;
export type AdminPlatformAccessUpsert = z.infer<
  typeof adminPlatformAccessUpsertSchema
>;
