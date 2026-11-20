import { useState } from 'react';
import { useNavigate } from 'react-router';
import { mergeProducts } from '@/catalog';
import type { Product } from '@/domain';
import type { PretometruDB } from '@/storage';
import { ProductPicker } from './ProductPicker';
import { button, card, dangerButton, muted } from './styles';

/** Folds this product into another one: its purchases and learned names follow, it disappears. */
export function MergePanel({
  db,
  product,
  onCancel,
}: {
  db: PretometruDB;
  product: Product;
  onCancel: () => void;
}) {
  const navigate = useNavigate();
  const [target, setTarget] = useState<Product>();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const merge = async () => {
    if (!target) return;
    setBusy(true);
    setFailed(false);
    try {
      await mergeProducts(db, target.id, [product.id]);
      await navigate(`/produse/${target.id}`);
    } catch {
      setFailed(true);
      setBusy(false);
    }
  };

  return (
    <section className={`${card} space-y-3`} aria-labelledby="merge-title">
      <h2 id="merge-title" className="text-base font-semibold">
        Îmbină cu alt produs
      </h2>
      <p className={muted}>
        Folosește asta când „{product.name}” și alt produs sunt de fapt același lucru.
      </p>
      <ProductPicker
        db={db}
        exclude={product.id}
        value={target}
        onChange={setTarget}
        legend="Îmbină în produsul"
      />
      {target && (
        <p className="text-sm">
          Achizițiile, denumirile învățate și elementele din liste se mută la „{target.name}”. „
          {product.name}” dispare.
        </p>
      )}
      {failed && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          Nu am putut îmbina produsele. Nu s-a schimbat nimic.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={dangerButton}
          disabled={!target || busy}
          onClick={() => void merge()}
        >
          Îmbină
        </button>
        <button type="button" className={button} onClick={onCancel} disabled={busy}>
          Renunță
        </button>
      </div>
    </section>
  );
}
