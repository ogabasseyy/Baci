import { expect, it } from 'vitest';
import {
  PIGGYVEST_RUNTIME_COMPOSITION_LIMITS,
  RUNTIME_COMPOSITION_METHODS,
} from './runtime-composition.constants';

it('bounds request time, headers and response size', () => {
  expect(PIGGYVEST_RUNTIME_COMPOSITION_LIMITS).toEqual({
    requestTimeoutMs: 8000,
    maxHeaderBytes: 8192,
    maxHeaders: 64,
    maxResponseBytes: 262144,
  });
});

it('allows only exact local operation methods with guarded savings exit routes', () => {
  expect(RUNTIME_COMPOSITION_METHODS).toEqual({
    '/policy': ['GET', 'POST'],
    '/cancel': ['GET', 'POST'],
    '/recovery': ['GET'],
    '/csrf': ['GET'],
    '/screen': ['GET'],
    '/funding': ['GET'],
    '/card-contributions': ['GET', 'POST'],
    '/purchase/quote': ['POST'],
    '/purchase/prepare': ['POST'],
    '/purchase/status': ['GET'],
    '/purchase/execute': ['POST'],
    '/cancel/execute': ['POST'],
    '/lifecycle/terms': ['POST'],
    '/lifecycle/activate': ['POST'],
    '/schedule': ['GET', 'POST'],
    '/close-plan': ['GET', 'POST'],
    '/device-change/quote': ['POST'],
    '/device-change/confirm': ['POST'],
    '/device-change/status': ['GET'],
    '/protected-offer/publish': ['POST'],
    '/protected-offer/status': ['GET'],
    '/reconciliation': ['GET'],
    '/period-attribution': ['GET'],
  });
});
