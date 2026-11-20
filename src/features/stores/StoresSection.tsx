import { Link } from 'react-router';
import { listStores } from '@/admin';
import type { PretometruDB } from '@/storage';
import { buttonSecondary } from '@/ui/controls';
import { useDbQuery } from '@/ui/live';
import { plural } from '@/ui/plural';

async function summarize(db: PretometruDB): Promise<{ stores: number; receipts: number }> {
  const rows = await listStores(db);
  return { stores: rows.length, receipts: rows.reduce((sum, row) => sum + row.receipts, 0) };
}

/** The "Magazine" card of the Settings screen: how many there are, and the way to the screen that manages them. */
export default function StoresSection() {
  const summary = useDbQuery(summarize);

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600 dark:text-slate-400">
        Bonurile tale sunt grupate pe magazine
        {summary.status === 'ready'
          ? `: ${plural(summary.value.stores, 'magazin', 'magazine')}, ${plural(summary.value.receipts, 'bon', 'bonuri')}`
          : ''}
        . Poți redenumi magazinele, uni două magazine care sunt de fapt același și șterge un magazin
        fără bonuri.
      </p>
      <Link to="/setari/magazine" className={buttonSecondary}>
        Gestionează magazinele
      </Link>
    </div>
  );
}
