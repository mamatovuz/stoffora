import { Fragment, type ReactNode } from "react";

/*
 * Staffora AI javoblari uchun kichik va xavfsiz Markdown: sarlavha, ro‘yxat, jadval, **qalin**, *kursiv*,
 * `kod` va havola. HTML hech qachon kiritilmaydi (dangerouslySetInnerHTML yo‘q) — faqat React elementlari.
 */
const SAFE_URL = /^(https?:\/\/|\/)/i;

function inline(text: string, key = 0): ReactNode[] {
  const out: ReactNode[] = [];
  const pattern = /(\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)|\*([^*\s][^*]*)\*)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let i = 0;
  while ((match = pattern.exec(text))) {
    if (match.index > last) out.push(text.slice(last, match.index));
    const id = `${key}-${i++}`;
    if (match[2]) out.push(<strong key={id}>{match[2]}</strong>);
    else if (match[3]) out.push(<code key={id}>{match[3]}</code>);
    else if (match[4] && match[5])
      out.push(
        SAFE_URL.test(match[5]) ? (
          <a key={id} href={match[5]} target={match[5].startsWith("/") ? undefined : "_blank"} rel="noreferrer">
            {match[4]}
          </a>
        ) : (
          match[4]
        ),
      );
    else if (match[6]) out.push(<em key={id}>{match[6]}</em>);
    last = match.index + match[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const cells = (line: string) =>
  line
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((cell) => cell.trim());

export function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r/g, "").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i += 1;
      continue;
    }
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push(<h4 key={i}>{inline(heading[2], i)}</h4>);
      i += 1;
      continue;
    }
    // Jadval: | a | b | qatori va keyin |---|---|.
    if (line.trim().startsWith("|") && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1] || "")) {
      const head = cells(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].trim().startsWith("|")) rows.push(cells(lines[i++]));
      blocks.push(
        <div key={`t${i}`} className="md-table">
          <table>
            <thead>
              <tr>
                {head.map((h, k) => (
                  <th key={k}>{inline(h, k)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, k) => (
                    <td key={k}>{inline(cell, k)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }
    const bullet = /^\s*([-*•]|\d+[.)])\s+/;
    if (bullet.test(line)) {
      const ordered = /^\s*\d/.test(line);
      const items: string[] = [];
      while (i < lines.length && bullet.test(lines[i])) items.push(lines[i++].replace(bullet, ""));
      const List = ordered ? "ol" : "ul";
      blocks.push(
        <List key={`l${i}`}>
          {items.map((item, k) => (
            <li key={k}>{inline(item, k)}</li>
          ))}
        </List>,
      );
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !bullet.test(lines[i]) && !/^#{1,4}\s/.test(lines[i]) && !lines[i].trim().startsWith("|")) para.push(lines[i++]);
    blocks.push(
      <p key={`p${i}`}>
        {para.map((row, k) => (
          <Fragment key={k}>
            {k > 0 && <br />}
            {inline(row, k)}
          </Fragment>
        ))}
      </p>,
    );
  }
  return <div className="md">{blocks}</div>;
}
