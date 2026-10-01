// Re-export the native module. On web, it will be resolved to BaciPerformanceTraceModule.web.ts
// and on native platforms to BaciPerformanceTraceModule.ts

export * from './src/BaciPerformanceTrace.types';
export { default } from './src/BaciPerformanceTraceModule';
