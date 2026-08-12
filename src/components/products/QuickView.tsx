import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { X } from 'lucide-react';
import { useCartStore } from '../../store/cartStore';
import { useUIStore } from '../../store/uiStore';
import { useScrollLock } from '../../hooks/useSmoothScroll';
import { formatPrice } from '../../utils/format';
import { media } from '../../assets/media';
import type { Product } from '../../types';

interface QuickViewProps {
  product: Product | null;
  onClose: () => void;
}

export default function QuickView({ product, onClose }: QuickViewProps) {
  const [size, setSize] = useState('');
  const addItem = useCartStore((s) => s.addItem);
  const openCart = useUIStore((s) => s.openCart);
  const showToast = useUIStore((s) => s.showToast);

  useScrollLock(Boolean(product));

  useEffect(() => {
    setSize(product?.sizes?.[0]?.size ?? '');
  }, [product]);

  useEffect(() => {
    if (!product) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [product, onClose]);

  if (!product) return null;

  const handleAdd = () => {
    if (!size) {
      showToast('Select a size first', 'error');
      return;
    }
    addItem(product.id, size, 1, product);
    onClose();
    openCart();
  };

  return (
    <div className="fixed inset-0 z-[72] flex items-center justify-center px-4" role="dialog" aria-modal="true" aria-label={`${product.name} quick view`}>
      <button className="absolute inset-0 bg-obsidian/80 backdrop-blur-sm" onClick={onClose} aria-label="Close quick view" />

      <div className="relative grid w-full max-w-3xl animate-fade-up grid-cols-1 border border-stone/40 bg-charcoal sm:grid-cols-2">
        <button
          onClick={onClose}
          className="absolute right-3 top-3 z-10 text-fog transition-colors hover:text-pearl"
          aria-label="Close quick view"
        >
          <X size={18} />
        </button>

        <div className="aspect-[3/4] overflow-hidden bg-stone/20">
          <img
            src={product.images?.[0]?.url ?? media.productFallback}
            alt={product.name}
            className="h-full w-full object-cover"
          />
        </div>

        <div className="flex flex-col p-6 lg:p-8">
          {product.isLimited && (
            <span className="mb-3 text-meta uppercase text-denim">Limited Edition</span>
          )}
          <h2 className="font-display text-3xl">{product.name}</h2>
          <span className="mt-2 font-display text-xl text-mist">
            {formatPrice(product.price, product.currency)}
          </span>

          <p className="mt-4 line-clamp-4 text-sm leading-relaxed text-mist">
            {product.description}
          </p>

          {product.sizes && product.sizes.length > 0 && (
            <div className="mt-6">
              <span className="mb-2 block text-meta uppercase text-fog">Size</span>
              <div className="flex flex-wrap gap-2">
                {product.sizes.map((s) => {
                  const soldOut =
                    (product.inventory?.find((i) => i.size === s.size)?.quantity ?? 1) < 1;
                  return (
                    <button
                      key={s.id}
                      disabled={soldOut}
                      onClick={() => setSize(s.size)}
                      aria-pressed={size === s.size}
                      className={`h-10 w-10 border text-xs transition-colors ${
                        size === s.size
                          ? 'border-pearl bg-pearl/10 text-pearl'
                          : soldOut
                            ? 'cursor-not-allowed border-stone/30 text-stone line-through'
                            : 'border-stone/50 text-fog hover:border-pearl/60'
                      }`}
                    >
                      {s.size}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="mt-auto space-y-3 pt-8">
            <button
              onClick={handleAdd}
              className="w-full bg-pearl py-3 text-sm uppercase tracking-[0.18em] text-obsidian transition-colors hover:bg-white"
            >
              Add to Cart
            </button>
            <Link
              to={`/product/${product.slug}`}
              onClick={onClose}
              className="block text-center text-meta uppercase text-fog transition-colors hover:text-pearl"
            >
              View full details
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
