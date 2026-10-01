import { QuizDateOfBirthGateModal } from './QuizDateOfBirthGateModal';
import { QuizUsernameGateModal } from './QuizUsernameGateModal';

interface QuizScreenModalsProps {
  dobGate: {
    cancelGate: () => void;
    confirmGate: (generation: number) => void;
    correctionError: string | null;
    dateOfBirth: string | null;
    generation: number;
    isGateVisible: boolean;
  };
  usernameGate: {
    cancelGate: () => void;
    confirmGate: () => void;
    isGateVisible: boolean;
  };
}

export function QuizScreenModals({
  dobGate,
  usernameGate,
}: QuizScreenModalsProps) {
  return (
    <>
      <QuizUsernameGateModal
        onCancel={usernameGate.cancelGate}
        onSuccess={usernameGate.confirmGate}
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
