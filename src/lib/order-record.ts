export type OrderItem = { name: string; quantity: number };
export type OrderDetails = { items: OrderItem[]; fulfillment: 'pickup' | 'delivery'; total: string; notes: string };

const marker = '[connection-pilot-order]';

export function orderDetailsFromNotes(notes?: string | null): OrderDetails {
  if (!notes?.startsWith(marker)) return { items: [], fulfillment: 'pickup', total: '', notes: notes || '' };
  const separator = notes.indexOf('\n');
  try {
    const parsed = JSON.parse(notes.slice(marker.length, separator === -1 ? undefined : separator)) as Partial<OrderDetails>;
    const items = Array.isArray(parsed.items) ? parsed.items.filter((item): item is OrderItem => typeof item?.name === 'string' && Number.isInteger(item.quantity) && item.quantity > 0).map((item) => ({ name: item.name, quantity: item.quantity })) : [];
    return { items, fulfillment: parsed.fulfillment === 'delivery' ? 'delivery' : 'pickup', total: typeof parsed.total === 'string' ? parsed.total : '', notes: separator === -1 ? '' : notes.slice(separator + 1) };
  } catch { return { items: [], fulfillment: 'pickup', total: '', notes }; }
}

export function orderDetailsToNotes(details: OrderDetails): string {
  const metadata = JSON.stringify({ items: details.items, fulfillment: details.fulfillment, total: details.total });
  return `${marker}${metadata}${details.notes ? `\n${details.notes}` : ''}`;
}

export function orderTitle(items: OrderItem[]): string {
  return items.map((item) => `${item.quantity} × ${item.name}`).join(', ').slice(0, 255);
}

const jobMarker = '[connection-pilot-job]';

export function jobDetailsFromNotes(notes?: string | null): { price: string; notes: string } {
  if (!notes?.startsWith(jobMarker)) return { price: '', notes: notes || '' };
  const separator = notes.indexOf('\n');
  try { const parsed = JSON.parse(notes.slice(jobMarker.length, separator === -1 ? undefined : separator)) as { price?: string }; return { price: typeof parsed.price === 'string' ? parsed.price : '', notes: separator === -1 ? '' : notes.slice(separator + 1) }; } catch { return { price: '', notes }; }
}

export function jobDetailsToNotes(price: string, notes: string): string {
  return `${jobMarker}${JSON.stringify({ price })}${notes ? `\n${notes}` : ''}`;
}
