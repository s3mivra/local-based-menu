// Markdown → styled PDF renderer (pdfkit). Tailored to MANUAL.md structure:
// h1/h2/h3, paragraphs with **bold**/`code`, bullet & numbered lists, pipe tables,
// blockquotes, fenced code blocks, and horizontal rules.
//
// Usage: node scripts_temp/md_to_pdf.cjs <input.md> <output.pdf>
const PDFDocument = require('./node_modules/pdfkit');
const fs = require('fs');
const path = require('path');

const C = {
  brand: '#6F874D', brandDark: '#4A5E33', accent: '#B8860B',
  ink: '#1E1E1E', muted: '#6B7280', line: '#E5E7EB',
  headBg: '#EFF3E8', codeBg: '#F4F4F2', quoteBar: '#B8C99A', white: '#FFFFFF',
};

const [, , INPUT, OUTPUT] = process.argv;
if (!INPUT || !OUTPUT) { console.error('Usage: node md_to_pdf.cjs <in.md> <out.pdf>'); process.exit(1); }

const md = fs.readFileSync(INPUT, 'utf8').replace(/\r\n/g, '\n');
const lines = md.split('\n');

const doc = new PDFDocument({ size: 'A4', margins: { top: 54, bottom: 60, left: 54, right: 54 },
  info: { Title: 'Semivra Libellus POS Manual', Author: 's3mivra', Creator: 'Semivra md_to_pdf' } });
doc.pipe(fs.createWriteStream(OUTPUT));

const ML = doc.page.margins.left;
const usableW = () => doc.page.width - doc.page.margins.left - doc.page.margins.right;
const bottom = () => doc.page.height - doc.page.margins.bottom;
const need = (h) => { if (doc.y + h > bottom()) doc.addPage(); };

// Strip emoji / non-Latin glyphs the core PDF fonts can't render (avoids tofu boxes).
const clean = (s) => s.replace(/[^\x00-\x017F₱•▶–—→…]/g, '').replace(/\s+/g, ' ').trim();

// Render a line of inline markdown (**bold**, `code`) as a run of styled text.
function inline(text, { size = 9.5, color = C.ink, indent = 0, gap = 4 } = {}) {
  const x = ML + indent;
  const w = usableW() - indent;
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean);
  need(doc.heightOfString(clean(text.replace(/[*`]/g, '')) || ' ', { width: w }) + gap);
  let first = true;
  parts.forEach((p, i) => {
    const last = i === parts.length - 1;
    let t = p, font = 'Helvetica', col = color;
    if (/^\*\*[^*]+\*\*$/.test(p)) { t = p.slice(2, -2); font = 'Helvetica-Bold'; }
    else if (/^`[^`]+`$/.test(p)) { t = p.slice(1, -1); font = 'Courier'; col = C.brandDark; }
    doc.font(font).fontSize(size).fillColor(col)
      .text(clean(t), first ? x : undefined, first ? doc.y : undefined,
        { width: w, continued: !last, lineGap: 1 });
    first = false;
  });
  doc.moveDown(gap / size);
}

function rule() { need(14); doc.moveTo(ML, doc.y + 4).lineTo(ML + usableW(), doc.y + 4).lineWidth(0.6).strokeColor(C.line).stroke(); doc.y += 12; }

function heading(level, text) {
  const t = clean(text);
  if (level === 1) { if (doc.y > doc.page.margins.top + 5) doc.addPage(); doc.font('Helvetica-Bold').fontSize(20).fillColor(C.brandDark).text(t, ML, doc.y, { width: usableW() }); doc.y += 2; doc.moveTo(ML, doc.y).lineTo(ML + usableW(), doc.y).lineWidth(2).strokeColor(C.brand).stroke(); doc.y += 12; }
  else if (level === 2) { need(40); doc.y += 6; doc.font('Helvetica-Bold').fontSize(14).fillColor(C.brand).text(t, ML, doc.y, { width: usableW() }); doc.y += 6; }
  else { need(28); doc.y += 4; doc.font('Helvetica-Bold').fontSize(11).fillColor(C.ink).text(t, ML, doc.y, { width: usableW() }); doc.y += 4; }
}

function listItem(marker, text, indent) {
  const x = ML + indent;
  const bw = 16;
  const w = usableW() - indent - bw;
  const h = doc.heightOfString(clean(text.replace(/[*`]/g, '')) || ' ', { width: w });
  need(h + 4);
  const y0 = doc.y;
  doc.font('Helvetica-Bold').fontSize(9.5).fillColor(C.brand).text(marker, x, y0, { width: bw, lineBreak: false });
  // inline render the item body at the indented column
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean);
  let first = true;
  parts.forEach((p, i) => {
    const last = i === parts.length - 1;
    let t = p, font = 'Helvetica', col = C.ink;
    if (/^\*\*[^*]+\*\*$/.test(p)) { t = p.slice(2, -2); font = 'Helvetica-Bold'; }
    else if (/^`[^`]+`$/.test(p)) { t = p.slice(1, -1); font = 'Courier'; col = C.brandDark; }
    doc.font(font).fontSize(9.5).fillColor(col)
      .text(clean(t), first ? x + bw : undefined, first ? y0 : undefined, { width: w, continued: !last, lineGap: 1 });
    first = false;
  });
  doc.y = Math.max(doc.y, y0 + h) + 3;
}

function blockquote(text) {
  const x = ML + 10, w = usableW() - 14;
  const h = doc.heightOfString(clean(text.replace(/[*`]/g, '')) || ' ', { width: w }) + 8;
  need(h);
  const y0 = doc.y;
  doc.rect(ML, y0, 3, h).fill(C.quoteBar);
  doc.font('Helvetica-Oblique').fontSize(9).fillColor(C.muted).text(clean(text.replace(/\*\*/g, '')), x, y0 + 4, { width: w });
  doc.y = y0 + h + 4;
}

function codeBlock(rows) {
  const w = usableW();
  const lh = 11;
  const h = rows.length * lh + 10;
  need(h);
  const y0 = doc.y;
  doc.rect(ML, y0, w, h).fill(C.codeBg);
  doc.font('Courier').fontSize(8.5).fillColor(C.ink);
  rows.forEach((r, i) => doc.text(clean(r) || ' ', ML + 8, y0 + 6 + i * lh, { width: w - 16, lineBreak: false }));
  doc.y = y0 + h + 8;
}

function table(header, rows) {
  const w = usableW();
  const ncol = header.length;
  const colW = new Array(ncol).fill(w / ncol);
  const pad = 5;
  const cellH = (cells) => Math.max(...cells.map((c, i) =>
    doc.font('Helvetica').fontSize(8.5).heightOfString(clean(c.replace(/[*`]/g, '')) || ' ', { width: colW[i] - 2 * pad }))) + 2 * pad;

  const drawRow = (cells, isHead) => {
    const h = cellH(cells);
    need(h);
    const y0 = doc.y;
    if (isHead) doc.rect(ML, y0, w, h).fill(C.headBg);
    let x = ML;
    cells.forEach((c, i) => {
      doc.font(isHead ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5).fillColor(isHead ? C.brandDark : C.ink)
        .text(clean(c.replace(/\*\*/g, '')), x + pad, y0 + pad, { width: colW[i] - 2 * pad });
      x += colW[i];
    });
    // borders
    doc.lineWidth(0.5).strokeColor(C.line);
    doc.moveTo(ML, y0 + h).lineTo(ML + w, y0 + h).stroke();
    doc.y = y0 + h;
  };

  need(40);
  drawRow(header, true);
  rows.forEach(r => drawRow(r, false));
  doc.y += 8;
}

// ── Parse + render ──
let i = 0;
while (i < lines.length) {
  let ln = lines[i];

  // fenced code block
  if (/^```/.test(ln.trim())) {
    const buf = []; i++;
    while (i < lines.length && !/^```/.test(lines[i].trim())) { buf.push(lines[i]); i++; }
    i++; codeBlock(buf); continue;
  }
  // table: header line followed by |---| separator
  if (/^\s*\|.*\|\s*$/.test(ln) && i + 1 < lines.length && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
    const parseRow = (s) => s.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
    const header = parseRow(ln); i += 2;
    const rows = [];
    while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) { rows.push(parseRow(lines[i])); i++; }
    table(header, rows); continue;
  }
  const t = ln.trim();
  if (t === '') { i++; continue; }
  if (/^#{1}\s/.test(t)) { heading(1, t.replace(/^#\s/, '')); i++; continue; }
  if (/^#{2}\s/.test(t)) { heading(2, t.replace(/^##\s/, '')); i++; continue; }
  if (/^#{3,}\s/.test(t)) { heading(3, t.replace(/^#{3,}\s/, '')); i++; continue; }
  if (/^(---|___|\*\*\*)\s*$/.test(t)) { rule(); i++; continue; }
  if (/^>\s?/.test(t)) { blockquote(t.replace(/^>\s?/, '')); i++; continue; }
  // nested bullet (2+ leading spaces) vs top-level
  const bulletM = ln.match(/^(\s*)[-*]\s+(.*)/);
  if (bulletM) { const indent = bulletM[1].length >= 2 ? 22 : 6; listItem('•', bulletM[2], indent); i++; continue; }
  const numM = ln.match(/^(\s*)(\d+)\.\s+(.*)/);
  if (numM) { listItem(numM[2] + '.', numM[3], 6); i++; continue; }
  // plain paragraph
  inline(t);
  i++;
}

// Footer page numbers
const range = doc.bufferedPageRange ? null : null;
doc.end();
console.log('Wrote', OUTPUT);
