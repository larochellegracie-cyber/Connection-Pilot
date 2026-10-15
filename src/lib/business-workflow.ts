const foodBusinessPattern = /bakery|restaurant|cafe|café|coffee|food|catering|deli|pizzeria|pizza|takeaway|take-out|meal|dessert|florist/i;

export function isFoodBusiness(businessType?: string | null): boolean {
  return foodBusinessPattern.test(businessType || '');
}

export function workflowLabels(businessType?: string | null) {
  const food = isFoodBusiness(businessType);
  return {
    food,
    record: food ? 'order' : 'job',
    recordPlural: food ? 'orders' : 'jobs',
    schedule: food ? 'order schedule' : 'calendar',
    next: food ? 'next pickup' : 'next appointment',
  };
}
