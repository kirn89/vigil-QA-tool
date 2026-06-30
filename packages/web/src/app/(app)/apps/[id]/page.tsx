import { notFound } from 'next/navigation';
import { getAppReport, latestJob } from '../../../../lib/data.js';
import { createClient } from '../../../../lib/supabase/server.js';
import { FlowRow } from '../../../../components/FlowRow.js';
import { FindingItem } from '../../../../components/FindingItem.js';
import { CheckNowButton } from '../../../../components/CheckNowButton.js';

export default async function AppReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const report = await getAppReport(id);
  if (!report) notFound();

  const job = await latestJob(id);
  const sb = await createClient();
  const { data: appRow } = await sb.from('apps').select('preview_url').eq('id', id).maybeSingle();
  const hasPreview = !!appRow?.preview_url;
  return (
    <div className="mx-auto max-w-3xl px-8 py-10">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-medium">{report.app.name}</h1>
        <CheckNowButton appId={report.app.id} hasPreview={hasPreview} initialStatus={job?.status ?? null} />
      </div>

      <h2 className="mt-8 text-sm font-medium text-ink-soft">Watched flows</h2>
      <div className="mt-3 space-y-3">
        {report.flows.length === 0
          ? <p className="text-sm text-ink-soft">No watched flows yet.</p>
          : report.flows.map((f) => <FlowRow key={f.id} appId={report.app.id} flow={f} />)}
      </div>

      <h2 className="mt-10 text-sm font-medium text-ink-soft">Rest of your app</h2>
      {report.findings.length === 0
        ? <p className="mt-3 text-sm text-ink-faint">We found nothing else amiss.</p>
        : <ul className="mt-3 space-y-2">{report.findings.map((f, i) => <FindingItem key={i} finding={f} />)}</ul>}
    </div>
  );
}
