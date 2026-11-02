import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// Some providers wrap the whole answer in a Markdown fence despite the prompt.
// Unwrap only that envelope; preserve ordinary code blocks inside the document.
export function normalizeNotes(markdown: string) {
  const text = markdown.trim();
  const wrapped = /^(`{3,}|~{3,})(?:markdown|md)[ \t]*\r?\n([\s\S]*?)\r?\n\1$/.exec(text);
  return wrapped ? wrapped[2] : text;
}

export function MarkdownNotes({ text }: { text: string }) {
  return <div className="notes-content markdown-notes" aria-label="議事録" tabIndex={0}>
    <Markdown remarkPlugins={[remarkGfm]} skipHtml components={{
      table: ({ children }) => <div className="notes-table-scroll" role="region" aria-label="議事録の表" tabIndex={0}><table>{children}</table></div>,
      // Provider text must not load remote images/local files or navigate the app.
      img: ({ alt }) => <span className="notes-image-alt">{alt || '画像'}</span>,
      a: ({ children, href }) => <span className="notes-link" title={href}>{children}</span>,
    }}>{normalizeNotes(text)}</Markdown>
  </div>;
}
