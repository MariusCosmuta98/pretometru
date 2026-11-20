import { Link } from 'react-router';
import { buttonPrimary, card } from '@/ui/controls';

/** The first run: no receipt on the device yet, so the only useful thing is to add one. */
export function FirstRun() {
  return (
    <section aria-labelledby="home-first-run" className={`${card} space-y-3 text-center`}>
      <h2 id="home-first-run" className="text-lg font-semibold">
        Bine ai venit la Pretometru
      </h2>
      <p className="text-slate-700 dark:text-slate-300">
        Adaugă primul bon: un PDF, o poză sau un text lipit. După ce îl confirmi, aici vezi
        cheltuielile pe lună și pe categorii, ultimele bonuri și produsele care s-au scumpit.
      </p>
      <Link to="/adauga" className={buttonPrimary}>
        Adaugă primul bon
      </Link>
      <p className="text-sm text-slate-600 dark:text-slate-400">
        Datele rămân pe acest dispozitiv.
      </p>
    </section>
  );
}
