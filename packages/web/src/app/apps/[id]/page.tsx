import { notFound } from 'next/navigation';
import { getAppReport } from '../../../lib/data.js';
import { FlowReport } from '../../../components/FlowReport.js';
import { FindingsList } from '../../../components/FindingsList.js';

export default async function AppReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const report = await getAppReport(id);
  if (!report) notFound();
  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="text-xl font-semibold">{report.app.name}</h1>

      <h2 className="mt-8 text-sm font-semibold uppercase tracking-wide text-neutral-500">Watched flows</h2>
      <div className="mt-3 space-y-3">
        {report.flows.length === 0
          ? <p className="text-sm text-neutral-600">No watched flows yet.</p>
          : report.flows.map((f) => <FlowReport key={f.name} flow={f} />)}
      </div>

      <h2 className="mt-10 text-sm font-semibold uppercase tracking-wide text-neutral-500">Rest of your app</h2>
      <div className="mt-3"><FindingsList findings={report.findings} /></div>
    </main>
  );
}
