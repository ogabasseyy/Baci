import { z } from 'zod';
import { brilStashOperatorCommands } from './brilstash-operator';

export const brilStashOperatorEnvelope = z.strictObject({
  action: z.enum(
    Object.keys(
      brilStashOperatorCommands
    ) as (keyof typeof brilStashOperatorCommands)[]
  ),
  args: z.unknown(),
});
