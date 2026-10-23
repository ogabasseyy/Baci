import { createRoot } from 'react-dom/client';
import { connectPreviewApp, createPreviewHost } from './mcp-app-bridge';
import { StorefrontPreview } from './StorefrontPreview';

const element = document.getElementById('root');
if (element) {
  const host = createPreviewHost();
  createRoot(element).render(<StorefrontPreview host={host} />);
  void connectPreviewApp(host);
}
