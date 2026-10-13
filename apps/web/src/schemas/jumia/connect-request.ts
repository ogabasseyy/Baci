import { z } from 'zod';
import {
  jumiaSelfAuthorizationDiscoverySchema,
  jumiaSelfAuthorizationSelectionSchema,
} from './self-authorization';

export const jumiaConnectRequestSchema = z.union([
  jumiaSelfAuthorizationDiscoverySchema,
  z.object({
    connectionType: z.literal('self_authorization'),
    ...jumiaSelfAuthorizationSelectionSchema.shape,
  }),
  z.object({ connectionType: z.literal('oauth') }),
]);
