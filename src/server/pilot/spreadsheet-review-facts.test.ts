import { describe, expect, it } from 'vitest';
import { extractSpreadsheetReviewFacts } from './spreadsheet-review-facts.js';

describe('XLTX review findings', () => {
  it('turns valid Staci Bakes product, recipe, and supplier rows into review facts', () => {
    expect(extractSpreadsheetReviewFacts('Row 2: Product: Chocolate Cupcake | Category: Cupcakes | Selling Price: 4.5 | Cost to Make: 1.35 | Units in Stock: 24 | Reorder Level: 12 | Supplier: Sweet Supply Co. | Notes: Chocolate cake with vanilla buttercream')).toMatchObject([{ kind: 'price', subject: 'Chocolate Cupcake', value: '4.5' }]);
    expect(extractSpreadsheetReviewFacts('Row 14: Product: Chocolate Cupcake | Category: Flour | Selling Price: 0.08 | Cost to Make: kg')).toMatchObject([{ kind: 'resource_requirement', subject: 'Chocolate Cupcake', value: '0.08', unit: 'kg', details: 'Flour' }]);
    expect(extractSpreadsheetReviewFacts('Row 10: Product: Sweet Supply Co. | Category: Sarah Miller | Selling Price: 519-555-0142 | Cost to Make: orders@sweetsupply.example | Units in Stock: Flour, sugar | Reorder Level: 2 days | Supplier: Orders placed Monday and Thursday')).toMatchObject([{ kind: 'supplier_relationship', subject: 'Sweet Supply Co.', predicate: 'lead time', value: '2 days' }]);
  });

  it('skips the malformed header rows that previously created invalid facts', () => {
    expect(extractSpreadsheetReviewFacts('Row 13: Product: Product | Category: Ingredient | Selling Price: Quantity Required | Cost to Make: Unit')).toEqual([]);
    expect(extractSpreadsheetReviewFacts('Row 32: Product: Order ID | Category: Customer | Selling Price: Product | Cost to Make: Quantity | Units in Stock: Order Date | Reorder Level: Pickup Date | Supplier: Status | Notes: Total')).toEqual([]);
  });
});
