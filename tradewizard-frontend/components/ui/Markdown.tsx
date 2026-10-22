import { type ReactNode } from 'react';

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const tokens = text.split(
    /(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|\[[^\]]+\]\([^)]+\))/g
  );

  return tokens.map((token, index) => {
    const key = `${keyPrefix}-${index}`;
    if (!token) return null;

    if (
      (token.startsWith('**') && token.endsWith('**')) ||
      (token.startsWith('__') && token.endsWith('__'))
    ) {
      return (
        <strong key={key} className="font-semibold text-fg">
          {token.slice(2, -2)}
        </strong>
      );
    }

    if (token.startsWith('`') && token.endsWith('`')) {
      return (
        <code
          key={key}
          className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[0.85em] text-fg"
        >
          {token.slice(1, -1)}
        </code>
      );
    }

    const link = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (link) {
      const href = /^https?:\/\//i.test(link[2]) ? link[2] : '#';
      return (
        <a
          key={key}
          href={href}
          target="_blank"
          rel="noreferrer"
          className="text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent"
        >
          {link[1]}
        </a>
      );
    }

    return <span key={key}>{token}</span>;
  });
}

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

/** Small, dependency-free markdown renderer for agent output. */
export function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let code: string[] | null = null;

  function flushParagraph() {
    if (paragraph.length === 0) return;
    blocks.push(
      <p key={`p-${blocks.length}`} className="text-sm leading-7 text-muted">
        {renderInline(paragraph.join(' '), `p-${blocks.length}`)}
      </p>
    );
    paragraph = [];
  }

  function flushList() {
    if (!list) return;
    const items = list.items.map((item, index) => (
      <li key={`li-${blocks.length}-${index}`} className="pl-1">
        {renderInline(item, `li-${blocks.length}-${index}`)}
      </li>
    ));
    const className =
      'space-y-1.5 pl-5 text-sm leading-7 text-muted marker:text-muted/50';
    blocks.push(
      list.ordered ? (
        <ol key={`ol-${blocks.length}`} className={`${className} list-decimal`}>
          {items}
        </ol>
      ) : (
        <ul key={`ul-${blocks.length}`} className={`${className} list-disc`}>
          {items}
        </ul>
      )
    );
    list = null;
  }

  function flushCode() {
    if (!code) return;
    blocks.push(
      <pre
        key={`pre-${blocks.length}`}
        className="overflow-x-auto rounded-lg border border-border bg-bg p-3 font-mono text-xs leading-6 text-fg"
      >
        <code>{code.join('\n')}</code>
      </pre>
    );
    code = null;
  }

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed.startsWith('```')) {
      if (code) {
        flushCode();
      } else {
        flushParagraph();
        flushList();
        code = [];
      }
      continue;
    }

    if (code) {
      code.push(line);
      continue;
    }

    if (!trimmed) {
      flushParagraph();
      flushList();
      continue;
    }

    if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
      flushParagraph();
      flushList();
      const rows: string[][] = [];
      let cursor = i;
      while (cursor < lines.length) {
        const rowLine = lines[cursor].trim();
        if (!rowLine.startsWith('|') || !rowLine.endsWith('|')) break;
        const cells = splitRow(rowLine);
        if (!cells.every((cell) => /^:?-{2,}:?$/.test(cell))) {
          rows.push(cells);
        }
        cursor += 1;
      }
      if (rows.length > 0) {
        const [header, ...body] = rows;
        blocks.push(
          <div
            key={`table-${blocks.length}`}
            className="overflow-x-auto rounded-lg border border-border"
          >
            <table className="w-full border-collapse text-left text-xs">
              <thead className="bg-surface-2/60">
                <tr>
                  {header.map((cell, cellIndex) => (
                    <th
                      key={`th-${cellIndex}`}
                      className="whitespace-nowrap px-3 py-2 font-medium text-fg"
                    >
                      {renderInline(cell, `th-${blocks.length}-${cellIndex}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {body.map((row, rowIndex) => (
                  <tr
                    key={`tr-${rowIndex}`}
                    className="border-t border-border/60"
                  >
                    {row.map((cell, cellIndex) => (
                      <td
                        key={`td-${rowIndex}-${cellIndex}`}
                        className="px-3 py-2 align-top text-muted"
                      >
                        {renderInline(
                          cell,
                          `td-${blocks.length}-${rowIndex}-${cellIndex}`
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      }
      i = cursor - 1;
      continue;
    }

    const heading = trimmed.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      flushParagraph();
      flushList();
      const level = heading[1].length;
      const content = renderInline(
        heading[2],
        `h-${blocks.length}-${level}`
      );
      const style =
        level === 1
          ? 'font-display text-xl font-bold tracking-tight text-fg'
          : level === 2
            ? 'font-display text-base font-semibold text-fg'
            : 'text-sm font-semibold text-fg';
      blocks.push(
        level === 1 ? (
          <h1 key={`h-${blocks.length}`} className={style}>
            {content}
          </h1>
        ) : level === 2 ? (
          <h2 key={`h-${blocks.length}`} className={style}>
            {content}
          </h2>
        ) : (
          <h3 key={`h-${blocks.length}`} className={style}>
            {content}
          </h3>
        )
      );
      continue;
    }

    if (/^---+$/.test(trimmed)) {
      flushParagraph();
      flushList();
      blocks.push(
        <hr key={`hr-${blocks.length}`} className="border-border/60" />
      );
      continue;
    }

    if (trimmed.startsWith('>')) {
      flushParagraph();
      flushList();
      blocks.push(
        <blockquote
          key={`quote-${blocks.length}`}
          className="border-l-2 border-ai/40 pl-3 text-sm leading-7 text-muted"
        >
          {renderInline(
            trimmed.replace(/^>\s?/, ''),
            `quote-${blocks.length}`
          )}
        </blockquote>
      );
      continue;
    }

    const unordered = trimmed.match(/^[-*•]\s+(.*)$/);
    if (unordered) {
      flushParagraph();
      if (!list || list.ordered) {
        flushList();
        list = { ordered: false, items: [] };
      }
      list.items.push(unordered[1]);
      continue;
    }

    const ordered = trimmed.match(/^\d+[.)]\s+(.*)$/);
    if (ordered) {
      flushParagraph();
      if (!list || !list.ordered) {
        flushList();
        list = { ordered: true, items: [] };
      }
      list.items.push(ordered[1]);
      continue;
    }

    paragraph.push(trimmed);
  }

  flushParagraph();
  flushList();
  flushCode();

  return <div className="space-y-3">{blocks}</div>;
}
