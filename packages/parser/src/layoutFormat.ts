import type { Layout } from './diffRenames.js';

// Canonical on-disk format for `.layout.json` files.
//
// Goals (in order):
//   1. Minimize merge conflicts: one entry per line, alphabetically sorted,
//      trailing comma on every entry (including the last) so appends never
//      touch a sibling line.
//   2. Stable on re-write: integer-rounded coordinates, fixed key order
//      (x, y, width, height) inside each entry.
//
// The file is JSONC (JSON-with-trailing-commas), not strict JSON. The parser
// here strips trailing commas before delegating to JSON.parse, so it accepts
// both the new canonical format and the legacy multi-line strict-JSON files.

function stripTrailingCommas(text: string): string {
  let out = '';
  let inString = false;
  let escape = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (escape) {
      out += c;
      escape = false;
      continue;
    }
    if (inString) {
      if (c === '\\') {
        out += c;
        escape = true;
        continue;
      }
      if (c === '"') inString = false;
      out += c;
      continue;
    }
    if (c === '"') {
      inString = true;
      out += c;
      continue;
    }
    if (c === ',') {
      let j = i + 1;
      while (j < text.length && /\s/.test(text[j])) j++;
      if (text[j] === ']' || text[j] === '}') continue;
    }
    out += c;
  }
  return out;
}

export function parseLayout(text: string): Layout {
  const trimmed = text.trim();
  if (trimmed === '') return {};
  return JSON.parse(stripTrailingCommas(trimmed)) as Layout;
}

export function serializeLayout(layout: Layout): string {
  const keys = Object.keys(layout).sort();
  if (keys.length === 0) return '{}\n';
  const lines = keys.map(k => {
    const v = layout[k];
    const parts: string[] = [
      `"x": ${Math.round(v.x)}`,
      `"y": ${Math.round(v.y)}`,
    ];
    if (v.width != null) parts.push(`"width": ${Math.round(v.width)}`);
    if (v.height != null) parts.push(`"height": ${Math.round(v.height)}`);
    return `  ${JSON.stringify(k)}: {${parts.join(', ')}},`;
  });
  return `{\n${lines.join('\n')}\n}\n`;
}
