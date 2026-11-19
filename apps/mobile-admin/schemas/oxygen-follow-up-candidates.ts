import { z } from 'zod';
import { oxygenFollowUpCandidateSchema } from './oxygen-follow-up-candidate';

export const oxygenFollowUpCandidatesSchema = z
  .array(oxygenFollowUpCandidateSchema)
  .max(250);
