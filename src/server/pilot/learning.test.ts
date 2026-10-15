import { describe, expect, it } from 'vitest';
import { learningSearchTerms } from './learning-search.js';

describe('Pilot learning retrieval terms', () => {
  it('expands plural price and supplier questions to stored predicates', () => {
    expect(learningSearchTerms('What are the prices of my products?')).toEqual(expect.arrayContaining(['price', 'prices', 'pricing']));
    expect(learningSearchTerms('Who are my suppliers?')).toEqual(expect.arrayContaining(['supplier', 'suppliers']));
  });

  it('expands stock questions to inventory and reorder fields', () => {
    expect(learningSearchTerms('What products do I currently have in stock?')).toEqual(expect.arrayContaining(['inventory', 'stock', 'reorder']));
  });
});
