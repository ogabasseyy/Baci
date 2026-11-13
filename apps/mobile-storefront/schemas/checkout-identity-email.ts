import { z } from 'zod';

export const checkoutIdentityEmailSchema = z.email().max(254);
