import type { IsolatedMetricPayload } from './isolated-performance-observer';

export type IsolatedMetric = IsolatedMetricPayload & { cls: number };
export type IsolatedPerformanceReport = {
  host: IsolatedMetric;
  frame: IsolatedMetric;
  contentVisible: boolean;
  imagesDecoded: boolean;
  contaminated: boolean;
};

export type ContextInfo = { id: number; frameId: string; name: string };
export type FrameNode = { id: string; url: string };
export type FrameTreeNode = { frame: FrameNode; childFrames?: FrameTreeNode[] };
export type BindingEvent = {
  name: string;
  payload: string;
  executionContextId: number;
};
export type ContextEvent = {
  context: { id: number; name?: string; auxData?: { frameId?: string } };
};
export type DestroyedContextEvent = { executionContextId: number };
export type NavigatedFrameEvent = { frame: { id: string } };
export type AttachedFrameEvent = { frameId: string; parentFrameId?: string };
export type AttachedEvent = { targetInfo: { type: string; url?: string } };
