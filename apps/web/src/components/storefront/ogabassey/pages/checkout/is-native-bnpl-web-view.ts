export function isNativeBnplWebView(): boolean {
  return (
    typeof window !== 'undefined' && Boolean(window.ReactNativeWebView)
  );
}
