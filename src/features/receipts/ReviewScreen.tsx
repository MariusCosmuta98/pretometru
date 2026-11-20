import { Link, useLoaderData } from 'react-router';
import { buttonPrimary, card, noticeClass } from '@/ui/controls';
import type { ReviewData } from './reviewLoader';
import { ReviewEditor } from './review/ReviewEditor';

export function Component() {
  const data = useLoaderData<ReviewData>();

  if (data.status === 'not-found') {
    return (
      <section className={`${card} space-y-3 text-center`}>
        <p className="text-slate-700 dark:text-slate-300">
          Bonul căutat nu există sau a fost șters.
        </p>
        <Link to="/bonuri" className={buttonPrimary}>
          Înapoi la bonuri
        </Link>
      </section>
    );
  }

  if (data.status === 'error') {
    return (
      <section role="alert" className={noticeClass.error}>
        <p className="font-medium">Nu am putut deschide bonul.</p>
        <p className="mt-1 break-words opacity-80">{data.detail}</p>
      </section>
    );
  }

  // Keyed so that opening another receipt starts from its own saved state.
  return <ReviewEditor key={data.form.id ?? 'new'} data={data} />;
}
