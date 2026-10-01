import { z } from 'zod';
import { heroCarouselSlidePatchFields } from './hero-carousel-slide-patch-fields';

export const heroCarouselSlidePatchSchema = z
  .strictObject(heroCarouselSlidePatchFields)
  .refine(
    (value) => Object.keys(value).length > 0,
    'Expected at least one editable carousel slide field'
  );
