import { Search, X } from 'lucide-react';
import { Label } from '@/components/ui/label';
import type { EventFacets } from '@/lib/types';
import { cn } from '@/lib/utils';

export type Filters = { q: string; category: string | null; city: string | null };

export const EMPTY_FILTERS: Filters = { q: '', category: null, city: null };

/**
 * Search and filter, built as rows of plain text rather than dropdowns and
 * pills. There are rarely more than a handful of categories or cities, and a
 * row of words you can read at a glance beats a select you have to open.
 */
export function EventFilters({
  facets,
  filters,
  onChange,
  resultCount,
}: {
  facets: EventFacets;
  filters: Filters;
  onChange: (next: Filters) => void;
  resultCount: number;
}) {
  const active = Boolean(filters.q || filters.category || filters.city);

  return (
    <section aria-label="Search and filter events" className="flex flex-col gap-7 border-t pt-8">
      <div className="flex items-center gap-3 border-b pb-3">
        <Search className="size-4 shrink-0 text-muted" aria-hidden />
        <input
          type="search"
          value={filters.q}
          onChange={(e) => onChange({ ...filters, q: e.target.value })}
          placeholder="Search events, venues and cities"
          aria-label="Search events"
          className="h-8 w-full border-0 bg-transparent p-0 font-sans text-base text-foreground placeholder:text-faint focus-visible:ring-0 focus-visible:ring-offset-0"
        />
        {active ? (
          <button
            type="button"
            onClick={() => onChange(EMPTY_FILTERS)}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-sm text-xs text-muted transition-colors duration-[var(--dur-fast)] hover:text-foreground"
          >
            Clear
            <X className="size-3" aria-hidden />
          </button>
        ) : null}
      </div>

      {facets.categories.length > 0 ? (
        <FacetRow
          label="Category"
          options={facets.categories}
          selected={filters.category}
          onSelect={(category) => onChange({ ...filters, category })}
        />
      ) : null}

      {facets.cities.length > 0 ? (
        <FacetRow
          label="City"
          options={facets.cities}
          selected={filters.city}
          onSelect={(city) => onChange({ ...filters, city })}
        />
      ) : null}

      <p aria-live="polite" className="text-xs text-faint">
        {resultCount} {resultCount === 1 ? 'event' : 'events'}
        {active ? ' match' : ''}
      </p>
    </section>
  );
}

function FacetRow({
  label,
  options,
  selected,
  onSelect,
}: {
  label: string;
  options: string[];
  selected: string | null;
  onSelect: (value: string | null) => void;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-baseline sm:gap-8">
      <Label className="sm:w-20 sm:shrink-0">{label}</Label>
      <div className="flex flex-wrap gap-x-5 gap-y-2">
        <FacetOption active={selected === null} onClick={() => onSelect(null)}>
          All
        </FacetOption>
        {options.map((option) => (
          <FacetOption
            key={option}
            active={selected === option}
            onClick={() => onSelect(selected === option ? null : option)}
          >
            {option}
          </FacetOption>
        ))}
      </div>
    </div>
  );
}

function FacetOption({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'rounded-sm text-sm transition-colors duration-[var(--dur-fast)]',
        active ? 'text-foreground' : 'text-muted hover:text-foreground',
      )}
    >
      {children}
    </button>
  );
}
