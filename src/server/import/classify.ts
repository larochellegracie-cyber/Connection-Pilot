import { headerKey } from './normalize.js';
import { fieldsByKind } from './fields.js';
import { importKinds, type ImportKind, type ParsedSheet, type SheetKind, type SheetSuggestion } from './types.js';

const weekdays = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

function matches(header: string, synonym: string) { return header === synonym; }

/** Maps column indexes to field keys for one kind. Exact header names win; anything left stays unmapped for the owner to decide. */
export function suggestMapping(headers: string[], kind: ImportKind): Record<string, string> {
  const keys = headers.map(headerKey);
  const mapping: Record<string, string> = {};
  const used = new Set<number>();
  // Fields are tried in priority order; within a field, earlier synonyms are stronger.
  for (const field of fieldsByKind[kind]) {
    for (const synonym of field.synonyms) {
      const index = keys.findIndex((key, position) => !used.has(position) && matches(key, synonym));
      if (index >= 0) { mapping[String(index)] = field.key; used.add(index); break; }
    }
  }
  // Headers that merely contain a distinctive word ("Invoice #", "Quote Total") still map when the field is free.
  const taken = new Set(Object.values(mapping));
  for (const field of fieldsByKind[kind]) {
    if (taken.has(field.key)) continue;
    const index = keys.findIndex((key, position) => !used.has(position) && field.synonyms.some((synonym) => synonym.length >= 4 && key.includes(synonym) && !['name', 'number'].includes(synonym)));
    if (index >= 0) { mapping[String(index)] = field.key; used.add(index); taken.add(field.key); }
  }
  // A combined name is not needed when first and last name are both present.
  return mapping;
}

function scoreKind(headers: string[], mapping: Record<string, string>, kind: ImportKind, hint: string): number {
  const keys = headers.map(headerKey);
  const fields = new Set(Object.values(mapping));
  const has = (...names: string[]) => names.filter((name) => fields.has(name)).length;
  const anyHeader = (pattern: RegExp) => keys.some((key) => pattern.test(key));
  const hinted = (pattern: RegExp) => (pattern.test(hint) ? 3 : 0);
  const money = fields.has('total') || fields.has('subtotal');
  const customerLike = has('phone', 'email', 'address');
  switch (kind) {
    case 'customers': {
      const hasName = fields.has('name') || (fields.has('firstName') && fields.has('lastName'));
      if (!hasName) return 0;
      return 2 + customerLike + (fields.has('company') ? 1 : 0) + hinted(/customer|client|contact/) - (money ? 3 : 0) - (fields.has('role') ? 3 : 0) - (anyHeader(/employee|staff|position|role/) ? 3 : 0) - (fields.has('service') ? 2 : 0);
    }
    case 'employees': {
      const hasName = fields.has('name') || (fields.has('firstName') && fields.has('lastName'));
      if (!hasName) return 0;
      return (fields.has('role') ? 3 : 0) + (anyHeader(/employee|staff|hire|teammember/) ? 3 : 0) + hinted(/employee|staff|team/) + has('email', 'phone') - (money ? 2 : 0) - (fields.has('service') ? 1 : 0);
    }
    case 'services': {
      if (!fields.has('name') || !fields.has('price')) return 0;
      return 4 + hinted(/service|product|price|catalog|item/) - (has('customerName', 'phone', 'email') ? 4 : 0) - (fields.has('date') ? 2 : 0);
    }
    case 'jobs': {
      if (!fields.has('service')) return 0;
      return 1 + (fields.has('customerName') || fields.has('customerEmail') || fields.has('customerPhone') ? 2 : 0) + has('date', 'employee', 'status', 'address') + (anyHeader(/job|workorder|assigned|technician/) ? 3 : 0) + hinted(/job|work.?order|visit|appointment/) - (money ? 2 : 0);
    }
    case 'quotes': {
      if (!fields.has('total')) return 0;
      return 1 + (anyHeader(/quote|estimate|proposal/) ? 4 : 0) + hinted(/quote|estimate|proposal/) + (fields.has('customerName') ? 1 : 0) + (fields.has('expires') ? 2 : 0) - (anyHeader(/invoice/) ? 4 : 0) - (hint.match(/invoice/) ? 2 : 0);
    }
    case 'invoices': {
      if (!fields.has('total')) return 0;
      return 1 + (anyHeader(/invoice|billing/) ? 4 : 0) + hinted(/invoice|bill/) + (fields.has('customerName') ? 1 : 0) + (fields.has('due') ? 2 : 0) - (anyHeader(/quote|estimate|proposal/) ? 4 : 0) - (hint.match(/quote|estimate/) ? 2 : 0);
    }
  }
}

/** Reads a sheet's headers (and its file and sheet names) and suggests what it contains. */
export function suggestSheet(sheet: Pick<ParsedSheet, 'id' | 'fileName' | 'sheetName' | 'headers'>): SheetSuggestion {
  const keys = sheet.headers.map(headerKey);
  const hint = `${sheet.fileName} ${sheet.sheetName}`.toLowerCase();
  const mappings: SheetSuggestion['mappings'] = {};
  const scores: Array<[ImportKind, number]> = [];
  for (const kind of importKinds) {
    const mapping = suggestMapping(sheet.headers, kind);
    mappings[kind] = mapping;
    scores.push([kind, scoreKind(sheet.headers, mapping, kind, hint)]);
  }
  const days = keys.filter((key) => weekdays.includes(key)).length;
  if (days >= 3) return { id: sheet.id, kind: 'schedule', confidence: 'high', mappings };
  scores.sort((a, b) => b[1] - a[1]);
  const [best, second] = scores;
  if (!best || best[1] < 3) return { id: sheet.id, kind: 'unknown', confidence: 'unsure', mappings };
  const confident = best[1] - (second?.[1] ?? 0) >= 2;
  return { id: sheet.id, kind: best[0], confidence: confident ? 'high' : 'unsure', mappings };
}

export function isImportKind(value: string): value is ImportKind { return (importKinds as readonly string[]).includes(value); }
export type { SheetKind };
