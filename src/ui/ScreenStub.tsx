/** Placeholder body for screens that later phases will build. */
export function ScreenStub({ description }: { description: string }) {
  return (
    <section className="rounded-xl border border-dashed border-slate-300 p-6 text-center dark:border-slate-700">
      <p className="text-slate-700 dark:text-slate-300">{description}</p>
      <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Ecran în lucru.</p>
    </section>
  );
}
