import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getFlowDetail } from '../../../../../../lib/data.js';
import { RunTimeline } from '../../../../../../components/RunTimeline.js';

export default async function FlowDetailPage({ params }: { params: Promise<{ id: string; flowId: string }> }) {
  const { id, flowId } = await params;
  const detail = await getFlowDetail(id, flowId);
  if (!detail) notFound();
  return (
    <div className="mx-auto max-w-3xl px-8 py-10">
      <Link href={`/apps/${id}`} className="text-sm text-ink-soft hover:text-brand">← Back to {detail.flow.name}&apos;s app</Link>
      <h1 className="mt-2 text-2xl font-medium">{detail.flow.name}</h1>

      <h2 className="mt-8 text-sm font-medium text-ink-soft">Check history</h2>
      <div className="mt-3"><RunTimeline runs={detail.runs} /></div>

      <h2 className="mt-10 text-sm font-medium text-ink-soft">Steps we run</h2>
      <ol className="mt-3 space-y-1">
        {detail.steps.map((s) => (
          <li key={s.id} className="rounded-lg border border-line bg-surface px-4 py-2 text-sm">
            <span className="font-mono text-xs text-ink-faint">{s.kind}</span>
            {s.detail && <span className="ml-2 font-mono text-xs text-ink-soft">{s.detail}</span>}
          </li>
        ))}
      </ol>
    </div>
  );
}
