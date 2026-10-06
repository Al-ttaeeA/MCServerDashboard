/**
 * Ranked horizontal bars with labels and values — for "top N" lists
 * (death causes, categories). Value text stays in ink colours; only the bar
 * carries the series colour.
 */
export function BarList({
  items,
  color,
  formatValue = (v) => v.toLocaleString(),
}: {
  items: { label: string; value: number; hint?: string }[];
  color: string;
  formatValue?: (v: number) => string;
}) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <ul className="space-y-2.5">
      {items.map((item) => (
        <li key={item.label}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
            <span className="truncate text-ink-2" title={item.hint}>
              {item.label}
            </span>
            <span className="tabular font-medium">{formatValue(item.value)}</span>
          </div>
          <div className="h-1.5 rounded-full bg-grid">
            <div className="h-full rounded-full" style={{ width: `${(item.value / max) * 100}%`, background: color }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
