import { Suspense } from 'react';
import { useFeatures } from '@/app/FeaturesContext';
import { settingsSections } from '@/app/registry';

export function Component() {
  const sections = settingsSections(useFeatures());

  return (
    <div className="space-y-4">
      {sections.map((section) => (
        <section
          key={section.id}
          aria-labelledby={`settings-${section.id}`}
          className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
        >
          <h2 id={`settings-${section.id}`} className="mb-2 font-semibold">
            {section.title}
          </h2>
          <Suspense fallback={<p className="text-sm text-slate-500">Se încarcă…</p>}>
            <section.Component />
          </Suspense>
        </section>
      ))}
    </div>
  );
}
