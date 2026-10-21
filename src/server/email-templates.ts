type EmailBrand = {
  businessName: string;
  businessEmail?: string | null;
  phoneNumber?: string | null;
  logoUrl?: string | null;
  brandColour?: string | null;
};

type QuoteLine = { description: string; quantity: string; unitPrice: string; subtotal: string };
type InvoiceLine = QuoteLine;
type ScheduleShift = { startsAt: Date; endsAt: Date; location: string | null; notes: string | null };

const DEFAULT_BRAND_COLOUR = 'navy';

export function escapeEmailHtml(value: string | null | undefined) {
  return (value || '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character] || character));
}

function safeText(value: string | null | undefined) { return (value || '').replace(/[\r\n]+/g, ' ').trim(); }
function money(value: string) { return `$${Number(value).toFixed(2)}`; }
function formatDate(value: Date | null | undefined, timezone = 'America/Toronto') { return value ? new Intl.DateTimeFormat('en-CA', { timeZone: timezone, month: 'long', day: 'numeric', year: 'numeric' }).format(value) : null; }
function safeLogoUrl(value: string | null | undefined) { return value && /^https:\/\//i.test(value.trim()) ? value.trim() : null; }
function safeBrandColour(value: string | null | undefined) { return value && /^#[0-9a-f]{6}$/i.test(value.trim()) ? value.trim() : DEFAULT_BRAND_COLOUR; }
function footer(brand: EmailBrand) {
  const contacts = [brand.businessEmail, brand.phoneNumber].filter((value): value is string => Boolean(value && safeText(value)));
  return `<p style="margin:24px 0 0;color:slategray;font-size:12px;line-height:18px;text-align:center;">Sent by ${escapeEmailHtml(safeText(brand.businessName))}${contacts.length ? `<br/>${contacts.map((item) => escapeEmailHtml(safeText(item))).join(' · ')}` : ''}</p>`;
}

function shell(brand: EmailBrand, title: string, label: string, content: string) {
  const businessName = escapeEmailHtml(safeText(brand.businessName));
  const logo = safeLogoUrl(brand.logoUrl);
  const colour = safeBrandColour(brand.brandColour);
  return `<!doctype html><html><body style="margin:0;padding:0;background-color:whitesmoke;font-family:Arial,sans-serif;color:midnightblue;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td style="padding:24px 12px;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:640px;margin:0 auto;background-color:white;border:1px solid gainsboro;border-radius:16px;overflow:hidden;"><tr><td style="padding:28px 28px 24px;background-color:${colour};color:white;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td>${logo ? `<img src="${escapeEmailHtml(logo)}" alt="${businessName}" width="52" height="52" style="display:block;border:0;border-radius:10px;object-fit:contain;background-color:white;"/>` : ''}</td><td style="text-align:right;font-size:14px;font-weight:700;vertical-align:middle;">${businessName}</td></tr></table><p style="margin:24px 0 4px;font-size:12px;font-weight:700;letter-spacing:1px;text-transform:uppercase;">${escapeEmailHtml(label)}</p><h1 style="margin:0;font-size:30px;line-height:36px;color:white;">${escapeEmailHtml(title)}</h1></td></tr><tr><td style="padding:28px;">${content}${footer(brand)}</td></tr></table></td></tr></table></body></html>`;
}

function summaryRows(rows: Array<{ label: string; value: string; emphasis?: boolean }>) {
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:18px;border-top:1px solid gainsboro;">${rows.map((row) => `<tr><td style="padding:8px 0;color:slategray;font-size:14px;">${escapeEmailHtml(row.label)}</td><td style="padding:8px 0;text-align:right;font-size:${row.emphasis ? '20px' : '14px'};font-weight:${row.emphasis ? '700' : '600'};color:midnightblue;">${escapeEmailHtml(row.value)}</td></tr>`).join('')}</table>`;
}

export function quoteEmailTemplate(input: { brand: EmailBrand; customerName: string; quoteNumber: string; createdAt: Date | null; expiresAt: Date | null; lineItems: QuoteLine[]; subtotal: string; taxTotal: string; total: string; notes: string | null }) {
  const lineRows = input.lineItems.map((item) => `<tr><td style="padding:12px 8px 12px 0;border-bottom:1px solid gainsboro;font-size:14px;">${escapeEmailHtml(item.description)}</td><td style="padding:12px 8px;border-bottom:1px solid gainsboro;text-align:center;font-size:14px;">${escapeEmailHtml(item.quantity)}</td><td style="padding:12px 8px;border-bottom:1px solid gainsboro;text-align:right;font-size:14px;">${money(item.unitPrice)}</td><td style="padding:12px 0 12px 8px;border-bottom:1px solid gainsboro;text-align:right;font-size:14px;font-weight:700;">${money(item.subtotal)}</td></tr>`).join('');
  const created = formatDate(input.createdAt);
  const expiry = formatDate(input.expiresAt);
  const text = `Hello ${safeText(input.customerName)},\n\n${safeText(input.brand.businessName)} has prepared quote ${input.quoteNumber}.${created ? ` Quote date: ${created}.` : ''}${expiry ? ` Expires: ${expiry}.` : ''}\n\n${input.lineItems.map((item) => `${item.quantity} × ${item.description} — ${money(item.subtotal)}`).join('\n')}\n\nSubtotal: ${money(input.subtotal)}\nTax: ${money(input.taxTotal)}\nTotal: ${money(input.total)}${input.notes ? `\n\nNotes: ${safeText(input.notes)}` : ''}\n\nThank you,\n${safeText(input.brand.businessName)}`;
  const content = `<p style="margin:0 0 16px;font-size:16px;line-height:24px;">Hello ${escapeEmailHtml(input.customerName)},</p><p style="margin:0 0 20px;color:slategray;font-size:15px;line-height:23px;">Here is your quote from ${escapeEmailHtml(safeText(input.brand.businessName))}. Review the details below.</p><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:whitesmoke;border:1px solid gainsboro;border-radius:12px;"><tr><td style="padding:14px;"><strong>Quote ${escapeEmailHtml(input.quoteNumber)}</strong>${created ? `<br/><span style="color:slategray;font-size:13px;">Issued ${escapeEmailHtml(created)}</span>` : ''}${expiry ? `<br/><span style="color:slategray;font-size:13px;">Valid until ${escapeEmailHtml(expiry)}</span>` : ''}</td></tr></table><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:22px;"><thead><tr><th style="padding:0 8px 8px 0;text-align:left;color:slategray;font-size:12px;">Item</th><th style="padding:0 8px 8px;text-align:center;color:slategray;font-size:12px;">Qty</th><th style="padding:0 8px 8px;text-align:right;color:slategray;font-size:12px;">Unit price</th><th style="padding:0 0 8px 8px;text-align:right;color:slategray;font-size:12px;">Line total</th></tr></thead><tbody>${lineRows}</tbody></table>${summaryRows([{ label: 'Subtotal', value: money(input.subtotal) }, { label: 'Tax', value: money(input.taxTotal) }, { label: 'Total', value: money(input.total), emphasis: true }])}${input.notes ? `<div style="margin-top:20px;padding:16px;background-color:whitesmoke;border:1px solid gainsboro;border-radius:12px;"><strong style="font-size:14px;">Notes</strong><p style="margin:8px 0 0;color:slategray;font-size:14px;line-height:21px;">${escapeEmailHtml(input.notes).replace(/\n/g, '<br/>')}</p></div>` : ''}<p style="margin:24px 0 0;color:slategray;font-size:14px;line-height:21px;">Thank you for considering ${escapeEmailHtml(safeText(input.brand.businessName))}.</p>`;
  return { html: shell(input.brand, 'Your Quote', 'Quote', content), text };
}

export function invoiceEmailTemplate(input: { brand: EmailBrand; customerName: string; invoiceNumber: string; createdAt: Date | null; dueAt: Date | null; lineItems: InvoiceLine[]; subtotal: string; taxTotal: string; total: string; amountPaid: string; amountDue: string; status: string; notes: string | null }) {
  const quoteLike = quoteEmailTemplate({ ...input, quoteNumber: input.invoiceNumber, expiresAt: input.dueAt });
  const amountSummary = summaryRows([{ label: 'Amount paid', value: money(input.amountPaid) }, { label: 'Amount due', value: money(input.amountDue), emphasis: true }]);
  const footerStart = '<p style="margin:24px 0 0;color:slategray;font-size:14px;line-height:21px;">Thank you for considering';
  const html = quoteLike.html.replace('Your Quote', 'Invoice').replace('>Quote<', '>Invoice<').replace('Quote ', 'Invoice ').replace('Valid until', 'Due').replace(footerStart, `${amountSummary}${footerStart}`);
  const text = quoteLike.text.replace(/quote/gi, 'invoice').replace('Total:', `Status: ${input.status}\nTotal:`).replace(/Total: [^\n]*/, (totalLine) => `${totalLine}\nAmount paid: ${money(input.amountPaid)}\nAmount due: ${money(input.amountDue)}`);
  return { html, text };
}

export function scheduleEmailTemplate(input: { brand: EmailBrand; employeeName: string; weekStartsAt: Date; shifts: ScheduleShift[]; timezone: string }) {
  const weekStart = formatDate(input.weekStartsAt, input.timezone) || '';
  const dates = Array.from({ length: 7 }, (_, index) => new Date(input.weekStartsAt.getTime() + index * 86_400_000));
  const byDay = new Map(input.shifts.map((shift) => [new Intl.DateTimeFormat('en-CA', { timeZone: input.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(shift.startsAt), shift]));
  const rows = dates.map((day) => { const key = new Intl.DateTimeFormat('en-CA', { timeZone: input.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(day); const shift = byDay.get(key); const label = new Intl.DateTimeFormat('en-CA', { timeZone: input.timezone, weekday: 'long', month: 'short', day: 'numeric' }).format(day); if (!shift) return `<tr><td style="padding:12px 0;border-bottom:1px solid gainsboro;font-size:14px;">${escapeEmailHtml(label)}</td><td style="padding:12px 0;border-bottom:1px solid gainsboro;text-align:right;color:slategray;font-size:14px;">Day off</td></tr>`; const time = `${new Intl.DateTimeFormat('en-CA', { timeZone: input.timezone, hour: 'numeric', minute: '2-digit' }).format(shift.startsAt)}–${new Intl.DateTimeFormat('en-CA', { timeZone: input.timezone, hour: 'numeric', minute: '2-digit' }).format(shift.endsAt)}`; return `<tr><td style="padding:12px 0;border-bottom:1px solid gainsboro;font-size:14px;"><strong>${escapeEmailHtml(label)}</strong>${shift.location ? `<br/><span style="color:slategray;font-size:13px;">${escapeEmailHtml(safeText(shift.location))}</span>` : ''}${shift.notes ? `<br/><span style="color:slategray;font-size:13px;">${escapeEmailHtml(safeText(shift.notes))}</span>` : ''}</td><td style="padding:12px 0;border-bottom:1px solid gainsboro;text-align:right;font-size:14px;font-weight:700;">${escapeEmailHtml(time)}</td></tr>`; }).join('');
  const totalHours = input.shifts.reduce((total, shift) => total + (shift.endsAt.getTime() - shift.startsAt.getTime()) / 3_600_000, 0);
  const text = `Hi ${safeText(input.employeeName)},\n\nYour ${safeText(input.brand.businessName)} schedule for the week of ${weekStart}:\n\n${input.shifts.map((shift) => `${new Intl.DateTimeFormat('en-CA', { timeZone: input.timezone, weekday: 'long', month: 'long', day: 'numeric' }).format(shift.startsAt)}: ${new Intl.DateTimeFormat('en-CA', { timeZone: input.timezone, hour: 'numeric', minute: '2-digit' }).format(shift.startsAt)}–${new Intl.DateTimeFormat('en-CA', { timeZone: input.timezone, hour: 'numeric', minute: '2-digit' }).format(shift.endsAt)}`).join('\n')}\n\nTotal scheduled hours: ${totalHours.toFixed(1)}`;
  const content = `<p style="margin:0 0 16px;font-size:16px;line-height:24px;">Hi ${escapeEmailHtml(input.employeeName)},</p><p style="margin:0 0 20px;color:slategray;font-size:15px;line-height:23px;">Here is your schedule for the week of ${escapeEmailHtml(weekStart)}.</p><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">${rows}</table>${summaryRows([{ label: 'Total scheduled hours', value: totalHours.toFixed(1), emphasis: true }])}<p style="margin:24px 0 0;color:slategray;font-size:14px;line-height:21px;">Please contact your manager with any questions.</p>`;
  return { html: shell(input.brand, 'Your Schedule', 'Schedule', content), text };
}
