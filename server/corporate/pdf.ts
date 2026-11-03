const clean = (value: string) => value.normalize("NFKD").replace(/[‘’ʼ]/g, "'").replace(/[–—]/g, "-").replace(/[^\x20-\x7E]/g, "?");
const escapePdf = (value: string) => clean(value).replace(/([\\()])/g, "\\$1");

/** Tashqi binarsiz kichik, standart PDF generator. Matnni bir nechta A4 sahifaga bo‘ladi. */
export function simplePdf(title: string, content: string) {
  const lines: string[] = [];
  for (const raw of `${title}\n\n${content}`.split(/\r?\n/)) {
    const words = clean(raw).split(/\s+/); let line = "";
    for (const word of words) { const next = line ? `${line} ${word}` : word; if (next.length > 88) { lines.push(line); line = word; } else line = next; }
    lines.push(line);
  }
  const pages = Array.from({ length: Math.max(1, Math.ceil(lines.length / 48)) }, (_, i) => lines.slice(i * 48, (i + 1) * 48));
  const objects: string[] = ["<< /Type /Catalog /Pages 2 0 R >>", ""];
  const pageIds: number[] = [];
  const fontId = 3 + pages.length * 2;
  pages.forEach((page, index) => {
    const pageId = 3 + index * 2; const contentId = pageId + 1; pageIds.push(pageId);
    objects[pageId - 1] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`;
    const stream = `BT\n/F1 10 Tf\n50 792 Td\n14 TL\n${page.map((line) => `(${escapePdf(line)}) Tj T*`).join("\n")}\nET`;
    objects[contentId - 1] = `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`;
  });
  objects[1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;
  objects[fontId - 1] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  let pdf = "%PDF-1.4\n"; const offsets = [0];
  objects.forEach((object, index) => { offsets[index + 1] = Buffer.byteLength(pdf); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf); pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n `).join("\n")}\ntrailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf);
}
