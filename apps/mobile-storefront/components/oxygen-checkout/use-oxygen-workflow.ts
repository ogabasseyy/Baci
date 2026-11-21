import { type RefObject, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import type {
  OxygenWorkflowController,
  OxygenWorkflowState,
} from '@/services/oxygen/workflow';

type WorkflowFactory = (orderId: string) => OxygenWorkflowController;
let factory: WorkflowFactory | null = null;
/** Install once from the isolated checkout composition, with authenticated scope. */
export function configureOxygenWorkflowFactory(value: WorkflowFactory) {
  factory = value;
}
export function useOxygenWorkflow(
  orderId: string,
  create: WorkflowFactory | null = factory,
  hostedHandlesForeground?: RefObject<boolean>
) {
  const [state, setState] = useState<OxygenWorkflowState>({
    snapshot: null,
    busy: false,
    capabilities: null,
    error: null,
  });
  const [controller, setController] = useState<OxygenWorkflowController | null>(
    null
  );
  useEffect(() => {
    if (!create) return;
    const workflow = create(orderId);
    setState(workflow.getState());
    setController(workflow);
    const unsubscribe = workflow.subscribe(() => setState(workflow.getState()));
    void workflow.initialize();
    let previous = AppState.currentState;
    const subscription = AppState.addEventListener('change', (next) => {
      // The hosted surface owns return checks while its browser can be open.
      if (
        next === 'active' &&
        previous !== 'active' &&
        !hostedHandlesForeground?.current
      )
        void workflow.refresh();
      previous = next;
    });
    // Reads are explicit and bounded; no background timer or mutation retries.
    return () => {
      unsubscribe();
      subscription.remove();
      workflow.dispose();
    };
  }, [orderId, create, hostedHandlesForeground]);
  return {
    ...state,
    controller,
    refresh: controller?.refresh,
    execute: controller?.execute,
    recover: controller?.recover,
  };
}
