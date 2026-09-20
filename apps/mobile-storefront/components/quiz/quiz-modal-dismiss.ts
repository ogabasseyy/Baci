/**
 * Fallback delay before treating a closed quiz modal as dismissed. iOS
 * reports dismissal through Modal's onDismiss after its animation; Android
 * has no equivalent callback in the installed React Native release, so this
 * bound releases a withheld ad slot if onDismiss never arrives.
 */
export const QUIZ_MODAL_DISMISS_FALLBACK_MS = 600;
