// Test doubles shared by OrderDetailsScreenModals tests.

/** Renders the success modal's action and Done buttons as plain HTML. */
export function SuccessModalMock({
  actionLabel,
  onActionPress,
  onClose,
  visible,
}: {
  actionLabel?: string;
  onActionPress?: () => void;
  onClose: () => void;
  visible: boolean;
}) {
  if (!visible) return null;
  return (
    <div>
      {actionLabel && onActionPress ? (
        <button onClick={onActionPress} type="button">
          {actionLabel}
        </button>
      ) : null}
      <button onClick={onClose} type="button">
        Done
      </button>
    </div>
  );
}
