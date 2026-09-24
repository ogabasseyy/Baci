import { QuizDateOfBirthGateModal } from './QuizDateOfBirthGateModal';
import { QuizUsernameGateModal } from './QuizUsernameGateModal';
import type { useQuizDateOfBirthGate } from './useQuizDateOfBirthGate';
import type { useQuizStartGate } from './useQuizStartGate';

interface QuizGateModalsProps {
  dobGate: ReturnType<typeof useQuizDateOfBirthGate>;
  usernameGate: ReturnType<typeof useQuizStartGate>;
}

export function QuizGateModals({ dobGate, usernameGate }: QuizGateModalsProps) {
  return (
    <>
      <QuizUsernameGateModal
        onCancel={usernameGate.cancelGate}
        onSuccess={() => {
          usernameGate.confirmGate();
        }}
        visible={usernameGate.isGateVisible}
      />
      <QuizDateOfBirthGateModal
        errorMessage={dobGate.correctionError}
        initialValue={
          dobGate.correctionError
            ? (dobGate.dateOfBirth ?? undefined)
            : undefined
        }
        onCancel={dobGate.cancelGate}
        onSuccess={() => {
          dobGate.confirmGate(dobGate.generation);
        }}
        visible={dobGate.isGateVisible}
      />
    </>
  );
}
