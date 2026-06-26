import type { FlowReportVM } from '../lib/data.js';
import { VerdictBadge } from './VerdictBadge.js';

export function FlowReport({ flow }: { flow: FlowReportVM }) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <span className="font-medium">{flow.name}</span>
        <VerdictBadge verdict={flow.verdict} />
      </div>
      {flow.verdict === 'broken' && (
        <div className="mt-3">
          {flow.failedStepId && <p className="text-sm text-neutral-600">Failed at step {flow.failedStepId}</p>}
          <div className="mt-2 flex flex-wrap gap-2">
            {flow.shots.map((src, i) => (
              <img key={i} src={src} alt={`step screenshot ${i + 1}`} className="h-32 rounded border border-neutral-200" />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
