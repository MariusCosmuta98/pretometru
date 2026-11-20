import { Link } from 'react-router';

export function NotFound() {
  return (
    <section className="space-y-3 py-8 text-center">
      <p className="text-slate-600 dark:text-slate-400">Pagina cerută nu există.</p>
      <Link
        to="/"
        className="inline-block rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800"
      >
        Înapoi la Acasă
      </Link>
    </section>
  );
}
