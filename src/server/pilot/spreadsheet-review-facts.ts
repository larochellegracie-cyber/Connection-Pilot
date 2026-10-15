export type SpreadsheetReviewFact = {
  groupName: string;
  kind: 'price' | 'resource_requirement' | 'supplier_relationship';
  subject: string;
  predicate: 'price' | 'requires_material' | 'lead time';
  value: string;
  evidence: string;
  unit?: string;
  details?: string;
  confidence: 'explicit' | 'clearly_extracted';
};

function clean(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function normalized(value: string) {
  return clean(value.toLowerCase().replace(/[^a-z0-9]+/g, ' '));
}

function fieldsFromRow(line: string) {
  const values = new Map<string, string>();
  for (const cell of line.replace(/^Row\s+\d+\s*:\s*/i, '').split('|')) {
    const separator = cell.indexOf(':');
    if (separator < 1) continue;
    const label = normalized(cell.slice(0, separator));
    const value = clean(cell.slice(separator + 1));
    if (label && value) values.set(label, value);
  }
  return values;
}

function numericValue(value: string | undefined) {
  return value && /^[0-9]+(?:\.[0-9]+)?$/.test(value.trim()) ? value.trim() : undefined;
}

function isUnit(value: string | undefined) {
  return Boolean(value && /^(?:kg|g|lbs?|oz|cups?|tbsp|tablespoons?|tsp|teaspoons?|units?|items?)$/i.test(value.trim()));
}

export function extractSpreadsheetReviewFacts(line: string): SpreadsheetReviewFact[] {
  const fields = fieldsFromRow(line);
  const product = fields.get('product');
  const category = fields.get('category');
  const sellingPrice = numericValue(fields.get('selling price'));
  const costToMake = numericValue(fields.get('cost to make'));
  const recipeUnit = fields.get('cost to make');
  const isHeaderRow = !product || ['product', 'supplier', 'order id'].includes(normalized(product));
  if (isHeaderRow) return [];

  const facts: SpreadsheetReviewFact[] = [];
  if (sellingPrice && costToMake) facts.push({ groupName: 'Products and pricing', kind: 'price', subject: product, predicate: 'price', value: sellingPrice, evidence: line, unit: 'each', details: category, confidence: 'explicit' });
  if (category && sellingPrice && isUnit(recipeUnit)) facts.push({ groupName: 'Recipes and requirements', kind: 'resource_requirement', subject: product, predicate: 'requires_material', value: sellingPrice, evidence: line, unit: recipeUnit.toLowerCase(), details: category, confidence: 'clearly_extracted' });
  const leadTime = fields.get('reorder level');
  if (leadTime && /\b(?:day|days|week|weeks)\b/i.test(leadTime)) facts.push({ groupName: 'Supplier details', kind: 'supplier_relationship', subject: product, predicate: 'lead time', value: leadTime, evidence: line, details: fields.get('supplier'), confidence: 'clearly_extracted' });
  return facts;
}
