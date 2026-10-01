export interface BaciPerformanceTraceNativeModule {
  beginAsyncSection(name: string): number | null;
  endAsyncSection(name: string, cookie: number): void;
}
