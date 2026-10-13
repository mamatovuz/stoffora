/*
 * Telefonda jadval kartochkaga aylanadi (.table-cards): har bir katak oldida ustun nomi
 * (data-label) ko‘rinadi. Har bir <td>ga qo‘lda yozmaslik uchun — sarlavhadan (<th>) avtomatik.
 * Faqat yorlig‘i yo‘q kataklarga qo‘yiladi; qo‘lda berilgan data-label o‘zgarmaydi.
 */
function labelTable(table: HTMLTableElement) {
  const head = table.tHead?.rows[table.tHead.rows.length - 1];
  if (!head) return;
  const labels: string[] = [];
  for (const th of Array.from(head.cells)) {
    const text = (th.textContent || "").replace(/\s+/g, " ").trim();
    for (let i = 0; i < th.colSpan; i += 1) labels.push(text);
  }
  for (const body of [...Array.from(table.tBodies), ...(table.tFoot ? [table.tFoot] : [])])
    for (const row of Array.from(body.rows)) {
      let column = 0;
      for (const cell of Array.from(row.cells)) {
        const label = labels[column];
        // Birinchi ustun (odatda xodim nomi) — yorliqsiz, kartochka sarlavhasi bo‘ladi.
        if (column > 0 && label && !cell.hasAttribute("data-label") && cell.colSpan === 1) cell.setAttribute("data-label", label);
        column += cell.colSpan;
      }
    }
}

let scheduled = false;
function run() {
  scheduled = false;
  document.querySelectorAll<HTMLTableElement>("table.table-cards").forEach(labelTable);
}

export function startTableLabels() {
  if (typeof MutationObserver === "undefined") return;
  const observer = new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(run);
  });
  observer.observe(document.body, { childList: true, subtree: true });
  run();
}
