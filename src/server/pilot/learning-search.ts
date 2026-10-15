const learningAliases: Record<string, string[]> = {
  price: ['price', 'pricing', 'prices', 'rate', 'rates', 'selling'],
  supplier: ['supplier', 'suppliers', 'vendor', 'vendors', 'lead', 'time'],
  inventory: ['inventory', 'stock', 'reorder', 'on', 'hand'],
  ingredient: ['ingredient', 'ingredients', 'material', 'materials', 'recipe', 'recipes'],
  order: ['order', 'orders', 'pickup', 'customer'],
  policy: ['policy', 'policies', 'rule', 'rules'],
};

function normalized(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export function learningSearchTerms(query: string) {
  const terms = new Set(normalized(query).split(' ').filter((word) => word.length >= 3));
  for (const [canonical, aliases] of Object.entries(learningAliases)) {
    if (aliases.some((alias) => terms.has(alias))) {
      terms.add(canonical);
      aliases.forEach((alias) => terms.add(alias));
    }
  }
  return [...terms].slice(0, 14);
}
