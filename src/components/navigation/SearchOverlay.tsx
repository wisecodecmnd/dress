import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Search, X } from 'lucide-react';
import { api } from '../../services/api';
import { useUIStore } from '../../store/uiStore';
import { useScrollLock } from '../../hooks/useSmoothScroll';
import { formatPrice } from '../../utils/format';
import type { Product } from '../../types';

export default function SearchOverlay() {
  const isOpen = useUIStore((s) => s.isSearchOpen);
  const closeSearch = useUIStore((s) => s.closeSearch);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useScrollLock(isOpen);

  useEffect(() => {
    if (isOpen) inputRef.current?.focus();
    else {
      setQuery('');
      setResults([]);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeSearch();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, closeSearch]);

  // Debounced search; aborts stale responses so results can't arrive out of order.
  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) {
      setResults([]);
      return;
    }

    let cancelled = false;
    setLoading(true);
    const timer = window.setTimeout(async () => {
      try {
        const res = await api.search(term);
        if (!cancelled) setResults(res.products);
      } catch {
        if (!cancelled) setResults([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 280);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[75]" role="dialog" aria-modal="true" aria-label="Search">
      <div className="absolute inset-0 bg-obsidian/95 backdrop-blur-md" onClick={closeSearch} />

      <div className="relative mx-auto max-w-3xl px-6 pt-24 lg:pt-32">
        <div className="flex items-center gap-4 border-b border-stone/50 pb-4">
          <Search size={22} className="text-fog" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search the collection"
            aria-label="Search products"
            className="w-full bg-transparent font-display text-2xl text-pearl outline-none placeholder:text-stone lg:text-4xl"
          />
          <button onClick={closeSearch} aria-label="Close search" className="text-fog hover:text-pearl">
            <X size={22} />
          </button>
        </div>

        <div className="mt-8 max-h-[55vh] overflow-y-auto no-scrollbar">
          {loading && <p className="text-meta uppercase text-fog">Searching…</p>}

          {!loading && query.trim().length >= 2 && results.length === 0 && (
            <p className="text-mist">No pieces match “{query}”.</p>
          )}

          <ul className="space-y-2">
            {results.map((p) => (
              <li key={p.id}>
                <Link
                  to={`/product/${p.slug}`}
                  onClick={closeSearch}
                  className="flex items-center gap-4 border border-transparent p-3 transition-colors hover:border-stone/40"
                >
                  <div className="h-20 w-16 shrink-0 overflow-hidden bg-stone/20">
                    <img
                      src={p.images?.[0]?.url}
                      alt={p.name}
                      className="h-full w-full object-cover"
                      loading="lazy"
                    />
                  </div>
                  <div className="flex-1">
                    <p className="font-display text-lg">{p.name}</p>
                    <p className="text-xs uppercase tracking-widest text-fog">{p.category?.name}</p>
                  </div>
                  <span className="text-sm text-mist">{formatPrice(p.price, p.currency)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
