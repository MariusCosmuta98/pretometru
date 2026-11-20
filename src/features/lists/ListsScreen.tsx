import { useCallback, useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { loadListsOverview } from '@/lists';
import { noticeClass } from '@/ui/controls';
import { ListCard } from './ListCard';
import { NewListForm } from './NewListForm';
import { Failure, Loading } from './notices';
import { useDb, useDbQuery } from './useLive';

export function Component() {
  const database = useDb();
  const overview = useDbQuery(loadListsOverview);
  const navigate = useNavigate();
  const [notice, setNotice] = useState<string>();
  const newListInput = useRef<HTMLInputElement>(null);
  const activeHeading = useRef<HTMLHeadingElement>(null);
  const activeId = useId();

  // A list that was archived, restored or deleted takes its card (and the focus on it) away: say
  // what happened and leave focus at the top of the lists instead of on the page.
  const announce = useCallback((message: string, leaves: boolean) => {
    setNotice(message);
    if (leaves) activeHeading.current?.focus();
  }, []);

  if (overview.status === 'error') {
    return <Failure>Nu am putut deschide listele de pe acest dispozitiv.</Failure>;
  }
  if (overview.status === 'loading' || database.status !== 'ready') {
    return <Loading what="listele" />;
  }

  const { active, archived } = overview.value;
  const db = database.value;

  return (
    <div className="space-y-4">
      <NewListForm
        db={db}
        inputRef={newListInput}
        onCreated={(listId) => void navigate(`/liste/${listId}`)}
      />

      <p role="status" className={notice ? noticeClass.success : 'sr-only'}>
        {notice}
      </p>

      <section aria-labelledby={activeId} className="space-y-2">
        <h2
          id={activeId}
          ref={activeHeading}
          tabIndex={-1}
          className="text-base font-semibold outline-none"
        >
          Liste active
        </h2>
        {active.length === 0 ? (
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Nu ai nicio listă activă. Creează una mai sus: adaugi articole din produsele tale și
            vezi unde e cel mai ieftin fiecare.
          </p>
        ) : (
          <ul className="space-y-2">
            {active.map((summary) => (
              <ListCard key={summary.list.id} summary={summary} db={db} announce={announce} />
            ))}
          </ul>
        )}
      </section>

      {archived.length > 0 && (
        <details>
          <summary className="flex min-h-11 cursor-pointer items-center text-base font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600">
            Arhivate ({archived.length})
          </summary>
          <ul className="mt-2 space-y-2">
            {archived.map((summary) => (
              <ListCard key={summary.list.id} summary={summary} db={db} announce={announce} />
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
