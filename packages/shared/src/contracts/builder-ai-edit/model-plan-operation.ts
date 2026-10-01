import type { z } from 'zod';
import { createBuilderAiModelOperationSchema } from './create-builder-ai-model-operation-schema';

export const builderAiModelOperationSchema =
  createBuilderAiModelOperationSchema();

type BuilderAiCarouselSlideOperation = {
  componentId: string;
  kind: 'update_carousel_slide';
  slideIndex: number;
} & Record<string, unknown>;

export type BuilderAiModelOperation =
  | z.infer<typeof builderAiModelOperationSchema>
  | BuilderAiCarouselSlideOperation;
