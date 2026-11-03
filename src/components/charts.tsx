import { useId, useState } from 'react';

/** Connection Pilot's chart palette: navy, bright blue and lighter blues only. */
export const chartColors = { navy: '#0B1F44', blue: '#2454D6', sky: '#6C98FF', pale: '#C9D8F5', slate: '#8A9BBE', grid: '#E3EAF6' } as const;
export const moneyFormat = (value: number) => new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 }).format(value);
const compact = (value: number) => (value >= 1000 ? `$${Math.round(value / 100) / 10}k` : `$${Math.round(value)}`);

type Point = { label: string; received: number; invoiced: number };

/** Payments received (filled area) against amounts invoiced (dashed line), with a tooltip for each period. */
export function RevenueChart({ points, ariaLabel }: { points: Point[]; ariaLabel: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const id = useId();
  const width = 640; const height = 240; const pad = { left: 44, right: 12, top: 12, bottom: 28 };
  const max = Math.max(1, ...points.flatMap((point) => [point.received, point.invoiced]));
  const niceMax = (() => { const magnitude = 10 ** Math.floor(Math.log10(max)); return Math.ceil(max / magnitude * 2) / 2 * magnitude; })();
  const x = (index: number) => pad.left + (points.length === 1 ? (width - pad.left - pad.right) / 2 : (index / (points.length - 1)) * (width - pad.left - pad.right));
  const y = (value: number) => pad.top + (1 - value / niceMax) * (height - pad.top - pad.bottom);
  const line = (pick: (point: Point) => number) => points.map((point, index) => `${index === 0 ? 'M' : 'L'}${x(index).toFixed(1)},${y(pick(point)).toFixed(1)}`).join(' ');
  const area = `${line((point) => point.received)} L${x(points.length - 1).toFixed(1)},${y(0)} L${x(0).toFixed(1)},${y(0)} Z`;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((fraction) => fraction * niceMax);
  const labelEvery = Math.max(1, Math.ceil(points.length / 6));
  const active = hover === null ? null : points[hover];
  return <div className="relative">
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={ariaLabel} className="h-auto w-full" onMouseLeave={() => setHover(null)}>
      <defs><linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={chartColors.blue} stopOpacity="0.28" /><stop offset="100%" stopColor={chartColors.blue} stopOpacity="0.02" /></linearGradient></defs>
      {ticks.map((tick) => <g key={tick}><line x1={pad.left} x2={width - pad.right} y1={y(tick)} y2={y(tick)} stroke={chartColors.grid} /><text x={pad.left - 6} y={y(tick) + 4} textAnchor="end" fontSize="10" fill={chartColors.slate}>{compact(tick)}</text></g>)}
      <path d={area} fill={`url(#${id}-fill)`} />
      <path d={line((point) => point.invoiced)} fill="none" stroke={chartColors.navy} strokeWidth="1.75" strokeDasharray="5 4" />
      <path d={line((point) => point.received)} fill="none" stroke={chartColors.blue} strokeWidth="2.5" strokeLinejoin="round" />
      {points.map((point, index) => index % labelEvery === 0 && <text key={point.label + index} x={x(index)} y={height - 8} textAnchor={index === points.length - 1 && points.length > 1 ? 'end' : index === 0 && points.length > 1 ? 'start' : 'middle'} fontSize="10" fill={chartColors.slate}>{point.label}</text>)}
      {hover !== null && <><line x1={x(hover)} x2={x(hover)} y1={pad.top} y2={height - pad.bottom} stroke={chartColors.slate} strokeDasharray="3 3" /><circle cx={x(hover)} cy={y(points[hover].received)} r="4" fill={chartColors.blue} stroke="#fff" strokeWidth="2" /></>}
      {points.map((point, index) => <rect key={index} x={x(index) - (width - pad.left - pad.right) / points.length / 2} y={0} width={(width - pad.left - pad.right) / points.length} height={height} fill="transparent" onMouseEnter={() => setHover(index)} onMouseMove={() => setHover(index)} />)}
    </svg>
    {active && hover !== null && <div role="tooltip" className="pointer-events-none absolute top-1 z-10 rounded-lg border border-border bg-card px-3 py-2 text-xs shadow-lg" style={{ left: `${Math.min(78, Math.max(2, (x(hover) / width) * 100 - 8))}%` }}><p className="font-extrabold text-secondary">{active.label}</p><p className="text-primary">Received {moneyFormat(active.received)}</p><p className="text-secondary">Invoiced {moneyFormat(active.invoiced)}</p></div>}
    <div className="mt-1 flex flex-wrap gap-4 text-xs text-muted-foreground"><span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: chartColors.blue }} />Payments received</span><span className="flex items-center gap-1.5"><span className="h-0.5 w-4" style={{ background: chartColors.navy }} />Invoiced</span></div>
  </div>;
}

export type Segment = { label: string; value: number; color: string; note?: string };

/** A donut with the total in the middle and a legend. Segments with no value are left out. */
export function Donut({ segments, centerLabel, centerValue, ariaLabel, format = (value) => String(value) }: { segments: Segment[]; centerLabel: string; centerValue: string; ariaLabel: string; format?: (value: number) => string }) {
  const [hover, setHover] = useState<number | null>(null);
  const shown = segments.filter((segment) => segment.value > 0);
  const total = shown.reduce((sum, segment) => sum + segment.value, 0);
  const radius = 52; const circumference = 2 * Math.PI * radius;
  let offset = 0;
  return <div className="flex flex-col items-center gap-4 sm:flex-row">
    <div className="relative h-36 w-36 shrink-0">
      <svg viewBox="0 0 140 140" role="img" aria-label={ariaLabel} className="h-full w-full -rotate-90">
        <circle cx="70" cy="70" r={radius} fill="none" stroke={chartColors.grid} strokeWidth="16" />
        {shown.map((segment, index) => { const length = (segment.value / total) * circumference; const dash = `${Math.max(0, length - (shown.length > 1 ? 2 : 0))} ${circumference}`; const current = offset; offset += length; return <circle key={segment.label} cx="70" cy="70" r={radius} fill="none" stroke={segment.color} strokeWidth={hover === index ? 19 : 16} strokeDasharray={dash} strokeDashoffset={-current} onMouseEnter={() => setHover(index)} onMouseLeave={() => setHover(null)}><title>{`${segment.label}: ${format(segment.value)}`}</title></circle>; })}
      </svg>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center"><span className="text-xl font-extrabold tabular-nums text-secondary">{hover !== null && shown[hover] ? format(shown[hover].value) : centerValue}</span><span className="max-w-[5.5rem] text-[0.6875rem] leading-tight text-muted-foreground">{hover !== null && shown[hover] ? shown[hover].label : centerLabel}</span></div>
    </div>
    <ul className="grid w-full gap-2 text-sm">{shown.map((segment) => <li key={segment.label} className="flex items-center justify-between gap-3"><span className="flex items-center gap-2 text-secondary"><span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: segment.color }} />{segment.label}</span><span className="font-bold tabular-nums text-secondary">{format(segment.value)}{segment.note && <span className="ml-1.5 font-normal text-muted-foreground">{segment.note}</span>}</span></li>)}</ul>
  </div>;
}

/** Horizontal bars for a pipeline or a ranking. Widths are relative to the largest value. */
export function BarList({ rows, ariaLabel }: { rows: Array<{ label: string; value: number; display: string; note?: string; color?: string }>; ariaLabel: string }) {
  const max = Math.max(1, ...rows.map((row) => row.value));
  return <ul aria-label={ariaLabel} className="grid gap-2.5">{rows.map((row) => <li key={row.label} title={`${row.label}: ${row.display}${row.note ? ` · ${row.note}` : ''}`}>
    <div className="flex items-baseline justify-between gap-3 text-sm"><span className="font-semibold text-secondary">{row.label}</span><span className="tabular-nums text-secondary"><strong>{row.display}</strong>{row.note && <span className="ml-1.5 text-xs text-muted-foreground">{row.note}</span>}</span></div>
    <div className="mt-1 h-2.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full" style={{ width: `${Math.max(row.value > 0 ? 3 : 0, (row.value / max) * 100)}%`, background: row.color ?? chartColors.blue }} /></div>
  </li>)}</ul>;
}

/** Vertical columns with a label under each and a tooltip on hover. */
export function Columns({ points, ariaLabel, unit }: { points: Array<{ label: string; value: number }>; ariaLabel: string; unit: string }) {
  const max = Math.max(1, ...points.map((point) => point.value));
  const labelEvery = Math.max(1, Math.ceil(points.length / 8));
  return <div role="img" aria-label={`${ariaLabel}: ${points.map((point) => `${point.label} ${point.value}`).join(', ')}`}>
    <div className="flex h-32 items-end gap-1">{points.map((point, index) => <div key={point.label + index} className="group relative flex h-full flex-1 items-end" title={`${point.label}: ${point.value} ${unit}`}><div className="w-full rounded-t" style={{ height: `${point.value > 0 ? Math.max(4, (point.value / max) * 100) : 1.5}%`, background: point.value > 0 ? chartColors.blue : chartColors.pale }} /></div>)}</div>
    <div className="mt-1 flex gap-1 text-[0.625rem] text-muted-foreground">{points.map((point, index) => <span key={point.label + index} className="flex-1 truncate text-center">{index % labelEvery === 0 ? point.label : ''}</span>)}</div>
  </div>;
}

/** A single percentage as a ring. */
export function Ring({ percent, label, ariaLabel }: { percent: number; label: string; ariaLabel: string }) {
  const radius = 40; const circumference = 2 * Math.PI * radius;
  return <div className="relative h-28 w-28 shrink-0"><svg viewBox="0 0 100 100" role="img" aria-label={ariaLabel} className="h-full w-full -rotate-90"><circle cx="50" cy="50" r={radius} fill="none" stroke={chartColors.grid} strokeWidth="12" /><circle cx="50" cy="50" r={radius} fill="none" stroke={chartColors.blue} strokeWidth="12" strokeLinecap="round" strokeDasharray={`${(Math.min(100, percent) / 100) * circumference} ${circumference}`} /></svg><div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center"><span className="text-2xl font-extrabold tabular-nums text-secondary">{percent}%</span><span className="text-[0.6875rem] text-muted-foreground">{label}</span></div></div>;
}
