import Link from 'next/link';
import type { FlowReportVM } from '../lib/data.js';
import { VerdictBadge } from './VerdictBadge.js';
import { ScreenshotStrip } from './ScreenshotStrip.js';
import { relativeTime } from '../lib/ui.js';

export function FlowRow({ appId, flow }: { appId: string; flow: FlowReportVM }) {
  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <div className="flex items-center justify-between">
        <Link href={`/apps/${appId}/flows/${flow.id}`} className="font-medium hover:text-brand">{flow.name}</Link>
        <div className="flex items-center gap-3">
          <span className="text-xs text-ink-faint">{relativeTime(flow.at).toLowerCase()}</span>
          <VerdictBadge verdict={flow.verdict} />
        </div>
      </div>
      {flow.verdict === 'broken' && (flow.failedStepId || flow.shots.length > 0) && (
        <div className="mt-3">
          {flow.failedStepId && <p className="text-sm text-ink-soft">Failed at step <span className="font-mono text-xs">{flow.failedStepId}</span></p>}
          <ScreenshotStrip shots={flow.shots} />
          <div className="mt-3 rounded-lg bg-surface-2 px-3 py-2 text-xs text-ink-faint">A suggested fix will appear here once diagnosis is available.</div>
        </div>
      )}
    </div>
  );
}
