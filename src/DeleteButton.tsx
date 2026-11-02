import { useEffect, useRef, useState } from 'react';
import { LoaderCircle, Trash2 } from 'lucide-react';

// Callers key this control by the deletion scope so changed selections require
// a fresh confirmation.
export function DeleteButton({ label, description, buttonText, onDelete, disabled = false }: {
  label: string; description: string; buttonText?: string; onDelete: () => Promise<void>; disabled?: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const lock = useRef(false);
  const confirm = useRef<HTMLButtonElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const verb = label.startsWith('清除') ? '清除' : '删除';
  function cancel() { setConfirming(false); setError(''); requestAnimationFrame(() => trigger.current?.focus()); }
  useEffect(() => { if (confirming) confirm.current?.focus(); }, [confirming]);
  async function remove() {
    if (lock.current || disabled) return;
    lock.current = true; setBusy(true); setError('');
    try { await onDelete(); setConfirming(false); }
    catch (cause) { setError((cause instanceof Error ? cause.message : String(cause)).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')); }
    finally { lock.current = false; setBusy(false); }
  }
  return <div className={'single-delete ' + (confirming ? 'confirming' : '')} onKeyDown={event => {
    if (event.key === 'Escape' && confirming && !busy) { event.stopPropagation(); cancel(); }
  }}>
    {!confirming ? <button ref={trigger} className="small-button delete-trigger" aria-label={label} title={label} disabled={disabled} onClick={() => setConfirming(true)}><Trash2 size={14} />{buttonText || verb}</button> : <>
      <span className="delete-description">{description}</span>
      <button ref={confirm} className="small-button danger" aria-label={'确认' + label} disabled={disabled || busy} onClick={() => void remove()}>{busy ? <LoaderCircle size={14} className="spin" /> : <Trash2 size={14} />}{busy ? `正在${verb}…` : `确认${verb}`}</button>
      <button className="small-button" disabled={busy} onClick={cancel}>取消</button>
    </>}
    {error && <span className="delete-error" role="alert">{error}</span>}
  </div>;
}
