import { PERIOD_CHOICES, type PeriodChoice } from './queries';

/** "3 luni / 6 luni / 12 luni / Tot": the period every spending card of the screen covers. */
export function PeriodPicker({
  value,
  onChange,
}: {
  value: PeriodChoice;
  onChange: (choice: PeriodChoice) => void;
}) {
  return (
    <div role="group" aria-label="Perioadă" className="flex flex-wrap gap-2">
      {PERIOD_CHOICES.map((choice) => (
        <button
          key={choice.param}
          type="button"
          aria-pressed={value === choice.value}
          onClick={() => {
            onChange(choice.value);
          }}
          className={`min-h-11 rounded-full border px-4 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600 ${
            value === choice.value
              ? 'border-teal-700 bg-teal-700 text-white'
              : 'border-slate-300 bg-white text-slate-700 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200'
          }`}
        >
          {choice.label}
        </button>
      ))}
    </div>
  );
}
