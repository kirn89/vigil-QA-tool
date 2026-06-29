export default function Loading() {
  return (
    <div className="mx-auto max-w-4xl px-8 py-10">
      <div className="h-7 w-40 rounded bg-surface-2" />
      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {[0, 1, 2, 3].map((i) => <div key={i} className="h-24 rounded-lg border border-line bg-surface" />)}
      </div>
    </div>
  );
}
