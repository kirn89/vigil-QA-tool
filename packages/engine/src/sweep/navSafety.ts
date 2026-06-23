/** Verbs whose presence in a control's label means clicking it could cause a
 *  side effect or an outward-facing action. The sweep reveals routes by clicking
 *  navigation controls only — anything that looks like an action is never clicked.
 *  "Sender" / "Senders" must NOT match "send", so we match on whole words. */
const UNSAFE_LABEL_WORDS = [
  'delete', 'remove', 'destroy', 'archive', 'cancel', 'unsubscribe', 'withdraw',
  'send', 'submit', 'post', 'publish', 'pay', 'buy', 'purchase', 'checkout',
  'order', 'confirm', 'logout', 'signout', 'logoff',
];

const UNSAFE_PHRASE_RE = /\b(log\s+out|sign\s+out|log\s+off)\b/;

/** True when a clickable control's accessible label looks destructive or
 *  outward-facing and therefore must not be clicked during route discovery. */
export function isUnsafeLabel(label: string): boolean {
  const lower = label.toLowerCase();
  if (UNSAFE_PHRASE_RE.test(lower)) return true;
  const words = lower.match(/[a-z]+/g) ?? [];
  return words.some((w) => UNSAFE_LABEL_WORDS.includes(w));
}
