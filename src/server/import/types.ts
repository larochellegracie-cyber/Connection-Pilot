export const importKinds = ['customers', 'employees', 'services', 'jobs', 'quotes', 'invoices'] as const;
export type ImportKind = (typeof importKinds)[number];
/** Recognised but not importable here (Scheduling has its own flow). */
export type SheetKind = ImportKind | 'schedule' | 'unknown';

export type ParsedSheet = { id: string; fileName: string; sheetName: string; headers: string[]; rows: string[][]; truncated: boolean };

/** What the owner (or Pilot's suggestion) decided for one sheet. `mapping` maps a column index to a field key, 'notes' or 'ignore'. */
export type SheetDecision = { id: string; kind: ImportKind | 'ignore'; mapping: Record<string, string> };

/** Owner choices for individual records. */
export type RecordChoice = 'skip' | 'create' | 'update' | 'merge';

export type ImportRequest = { sheets: ParsedSheet[]; decisions: SheetDecision[]; recordChoices?: Record<string, RecordChoice> };

export type SheetSuggestion = {
  id: string;
  kind: SheetKind;
  confidence: 'high' | 'unsure';
  /** Suggested column mapping for every kind, so changing the kind never needs another upload. */
  mappings: Partial<Record<ImportKind, Record<string, string>>>;
};

/** One row as shown to the owner in the review. */
export type PlanItem = {
  key: string; kind: ImportKind; row: number; fileName: string; label: string;
  display: Record<string, string>;
  issues: string[];
  action: 'create' | 'update' | 'skip';
  /** Why a record will not be imported. */
  reason?: string;
  /** True when the record was left out because of a problem (not because the owner chose to skip it). */
  problem?: boolean;
  /** Set when the owner is asked to decide about a possible duplicate. */
  duplicate?: { type: 'existing' | 'file'; description: string; options: RecordChoice[]; choice: RecordChoice };
};

export type CategoryPlan = {
  kind: ImportKind;
  /** Rows Pilot read for this category. */
  found: number;
  willCreate: number;
  willUpdate: number;
  skipped: number;
  /** Rows with a problem or a question for the owner. */
  needsAttention: number;
  /** Words about what happens automatically (for example that paid invoices also record a payment). */
  notes: string[];
  sample: PlanItem[];
  attention: PlanItem[];
};

export type Plan = { categories: Record<ImportKind, CategoryPlan>; found: number; willCreate: number; willUpdate: number };

export type ImportResult = {
  imported: Record<ImportKind, number>;
  updated: Record<ImportKind, number>;
  /** Anything not imported, with the reason, so nothing is silently lost. */
  issues: Array<{ kind: ImportKind; label: string; row: number; fileName: string; reason: string }>;
  failed: Array<{ kind: ImportKind; message: string }>;
};
