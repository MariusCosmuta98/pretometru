/** The category's emoji on its colour: the same badge in the list and in the form's preview. */
export function CategoryBadge({ icon, color }: { icon: string; color: string }) {
  return (
    <span
      aria-hidden="true"
      className="flex size-10 shrink-0 items-center justify-center rounded-full border-2 text-xl"
      style={{ borderColor: color, backgroundColor: `${color}26` }}
    >
      {icon}
    </span>
  );
}
