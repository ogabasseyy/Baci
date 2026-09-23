import { ROOT_DOCUMENT_CSS } from './root-document-css';

export function RootDocumentStyle() {
  return (
    <style href="root-document" precedence="high">
      {ROOT_DOCUMENT_CSS}
    </style>
  );
}
