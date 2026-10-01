import { requireOptionalNativeModule } from 'expo';
import type { BaciPerformanceTraceNativeModule } from './BaciPerformanceTrace.types';

export default requireOptionalNativeModule<BaciPerformanceTraceNativeModule>(
  'BaciPerformanceTrace'
);
