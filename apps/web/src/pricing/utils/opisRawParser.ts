import type { OpisRawMetricRow, OpisRawReport, OpisRawSection, OpisRawSupplierRow } from "../types/market";

const SECTION_METRIC_RE = /^(LOW RACK|HIGH RACK|RACK AVG|CAP-AT-THE-RACK|LCFS COST|FOB [A-Z ]+|BRD LOW RACK|BRD HIGH RACK|BRD RACK AVG|UBD LOW RACK|UBD HIGH RACK|UBD RACK AVG|CONT AVG-\d{2}\/\d{2}|CONT NET AVG-\d{2}\/\d{2}|CONT NET LOW-\d{2}\/\d{2}|CONT NET HI-\d{2}\/\d{2}|LOW RETAIL|AVG RETAIL|LOW RETAIL EX-TAX|AVG RETAIL EX-TAX)\b/i;
const LOCATION_TIMESTAMP_RE = /^([A-Z][A-Z .'-]+,\s*[A-Z]{2})(?:\s+(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} [A-Z]{3}))?$/;

function inferColumnsFromTitle(title: string) {
  const normalized = title.toLowerCase();
  if (normalized.includes("ethanol")) {
    return ["Terms", "Unl", "Move", "Mid", "Move", "Pre", "Move", "Date", "Time"];
  }
  if (normalized.includes("specialty distillate")) {
    return ["Terms", "JET", "Move", "MARINE", "Move", "Date", "Time"];
  }
  if (normalized.includes("aviation gas")) {
    return ["Terms", "Unl", "Move", "Date", "Time"];
  }
  if (normalized.includes("biodiesel")) {
    return ["Terms", "CULS", "CULS", "Move", "Date", "Time"];
  }
  if (normalized.includes("distillate")) {
    return ["Terms", "No2", "Move", "RD", "Move", "NRLM", "Move", "Date", "Time"];
  }
  return [];
}

function normalizeLines(text: string) {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+$/g, ""));
}

function splitBlocks(text: string) {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .split(/\n\s*\n+/)
    .map((block) => block.split("\n").map((line) => line.replace(/\s+$/g, "")).filter((line) => line.trim().length > 0))
    .filter((block) => block.length > 0);
}

function parseHeaderColumns(headerLine: string) {
  return headerLine.match(/\S+/g) || [];
}

function takeCell(tokens: string[], column: string, nextColumn?: string) {
  if (!tokens.length) return "";
  if (/^terms$/i.test(column)) {
    const parts = [tokens.shift() || ""];
    if (tokens.length && !/^[+-]$/.test(tokens[0]) && !/^\d/.test(tokens[0])) {
      parts.push(tokens.shift() || "");
    }
    return parts.filter(Boolean).join(" ").trim();
  }
  if (/^move$/i.test(column)) {
    if (tokens[0] === "--" && tokens[1] === "--") {
      tokens.shift();
      tokens.shift();
      return "-- --";
    }
    if (/^[+-]$/.test(tokens[0] || "")) {
      const sign = tokens.shift() || "";
      const value = tokens.shift() || "";
      return `${sign} ${value}`.trim();
    }
    return tokens.shift() || "";
  }
  if (/^date$/i.test(column)) {
    return tokens.shift() || "";
  }
  if (/^time$/i.test(column)) {
    return tokens.shift() || "";
  }
  if (tokens[0] === "--" && tokens[1] === "--") {
    tokens.shift();
    tokens.shift();
    return "-- --";
  }
  if (/^\d/.test(tokens[0] || "") || /^--$/.test(tokens[0] || "")) {
    return tokens.shift() || "";
  }
  if (nextColumn && /^move$/i.test(nextColumn) && /^[+-]$/.test(tokens[0] || "")) {
    return "";
  }
  return tokens.shift() || "";
}

function parseSupplierLine(line: string, headerColumns: string[]): OpisRawSupplierRow {
  const tokens = line.trim().match(/\S+/g) || [];
  if (!tokens.length) {
    return { supplier: "", cells: [], raw: line };
  }
  const supplier = tokens[0] || "";
  const remaining = tokens.slice(1);
  const cells = headerColumns.map((column, index) => takeCell(remaining, column, headerColumns[index + 1]));
  while (cells.length < headerColumns.length) cells.push("");
  return {
    supplier,
    cells: cells.slice(0, headerColumns.length),
    raw: line
  };
}

function parseMetricLine(line: string, subsection: string, headerColumns: string[]): OpisRawMetricRow | null {
  const match = line.match(SECTION_METRIC_RE);
  if (!match) return null;
  const label = match[0].trim();
  const values = line
    .slice(match[0].length)
    .trim()
    .split(/\s{2,}/)
    .map((value) => value.trim())
    .filter(Boolean);
  const dataTokens = line.slice(match[0].length).trim().match(/\S+/g) || [];
  const compactColumns = headerColumns.filter((column) => !/^terms$/i.test(column) && !/^date$/i.test(column) && !/^time$/i.test(column));
  const compactCells = compactColumns.map((column, index) => takeCell(dataTokens, column, compactColumns[index + 1]));
  const cells = headerColumns.map((column) => {
    if (/^terms$/i.test(column) || /^date$/i.test(column) || /^time$/i.test(column) || /^move$/i.test(column)) return "";
    return compactCells.shift() || "";
  });
  return {
    label,
    cells,
    values,
    subsection
  };
}

function parseSection(block: string[], index: number): OpisRawSection | null {
  const [firstLine, ...rest] = block;
  if (!firstLine) return null;

  const locationMatch = firstLine.trim().match(LOCATION_TIMESTAMP_RE);
  const market = locationMatch?.[1]?.trim() || "";
  const capturedAt = locationMatch?.[2]?.trim() || "";
  const titleLines = rest
    .filter((line) => /^\*{2}.+\*{2}$/.test(line.trim()))
    .map((line) => line.replace(/\*/g, "").trim());
  const content = rest.filter((line) => !/^\*{2}.+\*{2}$/.test(line.trim()));
  const retailLike = content.some((line) => /^LOW RETAIL\b/i.test(line.trim()));
  const noteLike = /^Copyright\b/i.test(firstLine.trim());
  const sectionType = noteLike ? "note" : retailLike ? "retail" : "benchmark";
  const title = titleLines.join(" / ") || (retailLike ? "Retail Summary" : market ? "OPIS raw section" : firstLine.trim());

  let headerLine = "";
  let supplierColumns: string[] = [];
  let subsection = "";
  const suppliers: OpisRawSupplierRow[] = [];
  const metrics: OpisRawMetricRow[] = [];
  const notes: string[] = [];

  for (const line of content) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (!headerLine && !/\d/.test(trimmed) && /(move|no\.?2|rd|nrlm|jet|marine|culs)/i.test(trimmed)) {
      continue;
    }
    if (/^OPIS [A-Z ]+\(/.test(trimmed) || /^OPIS [A-Z ]+DELIVERED SPOT/.test(trimmed)) {
      subsection = trimmed;
      continue;
    }
    if (!headerLine && /\bTerms\b/.test(trimmed)) {
      headerLine = trimmed;
      supplierColumns = parseHeaderColumns(trimmed);
      continue;
    }
    const metric = parseMetricLine(trimmed, subsection, supplierColumns);
    if (metric) {
      metrics.push(metric);
      continue;
    }
    if (/^Copyright\b/i.test(trimmed) || /^Rack prices are adjusted\b/i.test(trimmed) || /^modified to include\/exclude\b/i.test(trimmed) || /^Displays and agrees\b/i.test(trimmed) || /^rack prices\./i.test(trimmed) || /^Price files\./i.test(trimmed) || /^Subscriber\b/i.test(trimmed) || /^https?:\/\//i.test(trimmed)) {
      notes.push(trimmed);
      continue;
    }
    if (!headerLine && /^Terms\b/.test(trimmed)) {
      headerLine = trimmed;
      supplierColumns = parseHeaderColumns(trimmed);
      continue;
    }
    suppliers.push(parseSupplierLine(trimmed, supplierColumns));
  }

  if (!supplierColumns.length && sectionType === "benchmark") {
    supplierColumns = inferColumnsFromTitle(title);
  }

  return {
    id: `${market || "section"}-${index}`,
    market,
    capturedAt,
    title,
    sectionType,
    headerLine,
    supplierColumns,
    suppliers,
    metrics,
    notes,
    rawLines: block
  };
}

export function parseOpisRawReport(text: string): OpisRawReport {
  const blocks = splitBlocks(text);
  const sections = blocks
    .map((block, index) => parseSection(block, index))
    .filter((section): section is OpisRawSection => Boolean(section));
  const markets = [...new Set(sections.map((section) => section.market).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const generatedAt = sections.find((section) => section.capturedAt)?.capturedAt || "";
  const disclaimers = normalizeLines(text).filter((line) => /^Copyright\b/i.test(line.trim()) || /^Rack prices are adjusted\b/i.test(line.trim()) || /^modified to include\/exclude\b/i.test(line.trim()) || /^Displays and agrees\b/i.test(line.trim()) || /^Subscriber\b/i.test(line.trim()) || /^https?:\/\//i.test(line.trim()));
  return {
    generatedAt,
    markets,
    sections,
    disclaimers
  };
}
