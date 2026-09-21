import type { ModelEntry } from "./catalog.js";

export type DocCostRow = {
  name: string;
  id?: string;
  input: number;
  output: number;
  cache_read?: number;
  cache_write?: number;
};

export function parseMoneyCell(cell: string): number | undefined {
  const trimmed = cell.trim();
  if (!trimmed || trimmed === "—" || trimmed === "-") return undefined;
  if (/^free$/i.test(trimmed)) return 0;
  const amounts = [...trimmed.matchAll(/\$([0-9]+(?:\.[0-9]+)?)/g)].map((m) => Number(m[1]));
  if (amounts.length === 0) return undefined;
  return amounts[amounts.length - 1];
}

type CellRow = { cells: string[]; id?: string };

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function visibleCellText(innerHtml: string): string {
  const trunc = innerHtml.match(/<span class="truncate[^"]*"[^>]*>([^<]*)<\/span>/i);
  if (trunc?.[1]) return decodeEntities(trunc[1]).trim();
  return stripTags(innerHtml);
}

function headerName(cell: string): string {
  return cell.replace(/↕/g, "").replace(/\s+/g, " ").trim().toLowerCase();
}

function colIndex(headers: string[], name: string): number {
  return headers.findIndex((h) => h === name || h.startsWith(`${name} `) || h.startsWith(name));
}

function pipeRows(markdown: string): CellRow[] {
  const rows: CellRow[] = [];
  for (const line of markdown.split("\n")) {
    if (!line.includes("|")) continue;
    const cells = line
      .split("|")
      .map((c) => c.trim())
      .filter((c, i, arr) => !(i === 0 && c === "") && !(i === arr.length - 1 && c === ""));
    if (cells.length) rows.push({ cells });
  }
  return rows;
}

function htmlTableRows(html: string): CellRow[] {
  const rows: CellRow[] = [];
  const tables = html.match(/<table[\s\S]*?<\/table>/gi) ?? [];
  for (const table of tables) {
    const trs = table.match(/<tr[\s\S]*?<\/tr>/gi) ?? [];
    for (const tr of trs) {
      const rawCells = [...tr.matchAll(/<t[dh]\b[\s\S]*?<\/t[dh]>/gi)].map((m) => m[0]);
      if (rawCells.length === 0) continue;
      const cells = rawCells.map((raw) => {
        const inner = raw.replace(/^<t[dh]\b[^>]*>/i, "").replace(/<\/t[dh]>$/i, "");
        return visibleCellText(inner);
      });
      const href = tr.match(/href="\/models\/([^"?#]+)"/i)?.[1];
      rows.push({ cells, ...(href ? { id: href } : {}) });
    }
  }
  return rows;
}

function rowsFromGroup(group: CellRow[]): DocCostRow[] {
  if (group.length === 0) return [];

  let modelI = 0;
  let inputI = 2;
  let outputI = 3;
  let cacheReadI = 4;
  let cacheWriteI = 5;
  let start = 0;

  const headerIdx = group.findIndex((r) => /^model\b/i.test(headerName(r.cells[0] ?? "")));
  if (headerIdx >= 0) {
    const headers = group[headerIdx]!.cells.map(headerName);
    const foundInput = colIndex(headers, "input");
    const foundOutput = colIndex(headers, "output");
    if (foundInput >= 0 && foundOutput >= 0) {
      const foundModel = colIndex(headers, "model");
      if (foundModel >= 0) modelI = foundModel;
      inputI = foundInput;
      outputI = foundOutput;
      cacheReadI = colIndex(headers, "cache read");
      cacheWriteI = colIndex(headers, "cache write");
      start = headerIdx + 1;
    }
  }

  const rows: DocCostRow[] = [];
  for (let i = start; i < group.length; i++) {
    const { cells, id } = group[i]!;
    if (cells.length < 2) continue;
    const first = headerName(cells[0] ?? "");
    if (first === "model" || (cells[0] ?? "").startsWith("---")) continue;
    const input = parseMoneyCell(cells[inputI] ?? "");
    const output = parseMoneyCell(cells[outputI] ?? "");
    if (input === undefined || output === undefined) continue;
    const name = (cells[modelI] ?? "").trim();
    if (!name) continue;
    const row: DocCostRow = { name, input, output };
    if (id) row.id = id;
    if (cacheReadI >= 0) {
      const cacheRead = parseMoneyCell(cells[cacheReadI] ?? "");
      if (cacheRead !== undefined) row.cache_read = cacheRead;
    }
    if (cacheWriteI >= 0) {
      const cacheWrite = parseMoneyCell(cells[cacheWriteI] ?? "");
      if (cacheWrite !== undefined) row.cache_write = cacheWrite;
    }
    rows.push(row);
  }
  return rows;
}

export function parseModelsTable(markdown: string): DocCostRow[] {
  return [...rowsFromGroup(pipeRows(markdown)), ...rowsFromGroup(htmlTableRows(markdown))];
}

export function applyDocCosts(
  models: ModelEntry[],
  rows: DocCostRow[],
  cliIds: Set<string> = new Set(),
  filledIds?: Set<string>,
): number {
  const byName = new Map(rows.map((r) => [r.name.toLowerCase(), r]));
  const byId = new Map(rows.filter((r) => r.id).map((r) => [r.id!.toLowerCase(), r]));
  let filled = 0;
  for (const model of models) {
    if (cliIds.has(model.id)) continue;
    const row = byId.get(model.id.toLowerCase()) ?? byName.get(model.name.toLowerCase());
    if (!row) continue;
    model.cost = { input: row.input, output: row.output };
    if (row.cache_read !== undefined) model.cost.cache_read = row.cache_read;
    if (row.cache_write !== undefined) model.cost.cache_write = row.cache_write;
    filledIds?.add(model.id);
    filled++;
  }
  return filled;
}

export async function fetchOfficialModelsMarkdown(): Promise<string> {
  const urls = [
    "https://commandcode.ai/models",
    "https://commandcode.ai/docs/resources/pricing-limits",
  ];
  for (const url of urls) {
    try {
      const resp = await fetch(url);
      if (!resp.ok) continue;
      const text = await resp.text();
      if (parseModelsTable(text).length > 0) return text;
    } catch {
      // try next
    }
  }
  return "";
}
