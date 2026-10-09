import {
  assistanceFrameSchema,
  type SearchAssistanceFrame,
} from './assistance-frame';

export function encodeAssistanceFrame(frame: SearchAssistanceFrame): string {
  return `${JSON.stringify(assistanceFrameSchema.parse(frame))}\n`;
}
