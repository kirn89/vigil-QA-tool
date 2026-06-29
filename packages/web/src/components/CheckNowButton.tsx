export function CheckNowButton() {
  return (
    <button type="button" disabled title="Coming soon"
      className="inline-flex cursor-not-allowed items-center gap-2 rounded-lg bg-surface-2 px-3 py-1.5 text-sm text-ink-faint">
      <i className="ti ti-player-play" aria-hidden="true" />Check now
      <span className="rounded-full bg-surface px-1.5 py-0.5 text-[11px]">soon</span>
    </button>
  );
}
