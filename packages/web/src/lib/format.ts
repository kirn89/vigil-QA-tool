export type DisplayVerdict = 'pass' | 'broken' | 'unsure' | null;

/** Plain-English, deliberately non-alarmist labels (false alarms are the top product risk). */
export function statusLabel(verdict: DisplayVerdict): string {
  switch (verdict) {
    case 'pass': return 'All clear';
    case 'broken': return 'Broken';
    case 'unsure': return 'Needs a look';
    default: return 'Not checked yet';
  }
}
