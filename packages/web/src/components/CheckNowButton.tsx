'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { requestCheck, pollJob } from '../app/(app)/apps/[id]/check-now-actions.js';

type Status = 'queued' | 'running' | 'done' | 'failed' | null;

export function CheckNowButton({ appId, hasPreview, initialStatus }: { appId: string; hasPreview: boolean; initialStatus: Status }) {
  const router = useRouter();
  const [env, setEnv] = useState<'production' | 'preview'>('production');
  const active = initialStatus === 'queued' || initialStatus === 'running';
  const [busy, setBusy] = useState(active);
  const [message, setMessage] = useState<string | null>(null);

  async function start() {
    setBusy(true); setMessage(null);
    const res = await requestCheck(appId, env);
    if (!res.ok) { setBusy(false); setMessage(res.reason === 'busy' ? 'A check is already running.' : 'Could not start the check.'); return; }
    const poll = setInterval(async () => {
      const job = await pollJob(appId);
      if (!job || job.status === 'done' || job.status === 'failed') {
        clearInterval(poll); setBusy(false);
        setMessage(job?.status === 'failed' ? 'The check ran into a problem.' : null);
        router.refresh();
      }
    }, 3000);
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        {hasPreview && (
          <select value={env} onChange={(e) => setEnv(e.target.value as 'production' | 'preview')} disabled={busy}
            className="rounded-lg border border-line bg-surface px-2 py-1.5 text-sm">
            <option value="production">Production</option>
            <option value="preview">Preview</option>
          </select>
        )}
        <button type="button" onClick={start} disabled={busy}
          className="inline-flex items-center gap-2 rounded-lg bg-brand px-3 py-1.5 text-sm text-white hover:bg-brand-hover disabled:opacity-60">
          <i className="ti ti-player-play" aria-hidden="true" />
          {busy ? 'Checking…' : 'Check now'}
        </button>
      </div>
      {message && <span className="text-xs text-ink-faint">{message}</span>}
    </div>
  );
}
