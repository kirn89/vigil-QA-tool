export default function Loading() {
  return (
    <div className="mx-auto max-w-3xl px-8 py-10">
      <div className="h-7 w-48 rounded bg-surface-2" />
      <div className="mt-8 space-y-3">{[0, 1, 2].map((i) => <div key={i} className="h-16 rounded-lg border border-line bg-surface" />)}</div>
    </div>
  );
}
