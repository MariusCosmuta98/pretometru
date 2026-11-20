import { Link } from 'react-router';
import { isSystemCategory } from '@/admin';
import { listActive, type PretometruDB } from '@/storage';
import { buttonSecondary } from '@/ui/controls';
import { useDbQuery } from '@/ui/live';
import { plural } from '@/ui/plural';

async function countCategories(db: PretometruDB): Promise<number> {
  return (await listActive(db.categories)).filter((category) => !isSystemCategory(category)).length;
}

/** The "Categorii" card of the Settings screen: how many there are, and the way to the screen that manages them. */
export default function CategoriesSection() {
  const count = useDbQuery(countCategories);

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600 dark:text-slate-400">
        Categoriile grupează produsele și cheltuielile tale
        {count.status === 'ready' ? `: ${plural(count.value, 'categorie', 'categorii')}` : ''}. Le
        poți adăuga, redenumi, colora și ordona; la ștergere, produsele lor trec în altă categorie.
      </p>
      <Link to="/setari/categorii" className={buttonSecondary}>
        Gestionează categoriile
      </Link>
    </div>
  );
}
