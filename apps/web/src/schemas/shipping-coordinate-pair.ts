import { z } from 'zod';
import {
  LatitudeSchema,
  LongitudeSchema,
  requireCoordinatePair,
} from './shipping';

export const shippingCoordinatePairSchema = z
  .object({
    latitude: LatitudeSchema,
    longitude: LongitudeSchema,
  })
  .superRefine((pair, ctx) => requireCoordinatePair(pair, ctx));
