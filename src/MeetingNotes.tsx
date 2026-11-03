import { useEffect, useRef, useState } from 'react';
import { LoaderCircle, Sparkles, RotateCcw } from 'lucide-react';
import { MarkdownNotes } from './MarkdownNotes';
import { languages, type Session, type NotesLanguage, type NotesPlan, type NotesStatus, type Settings } from './types';

export function MeetingNotes({ session, disabled, onUpdate, onBusy }: { session: Session; disabled: boolean; onUpdate: (session: Session) => void; onBusy: (busy: boolean) => void }) {
  const [language, setLanguage] = useState<NotesLanguage>('auto');
  const [plan, setPlan] = useState<NotesPlan>();
  const [status, setStatus] = useState<NotesStatus>({ id: session.id, state: session.notesError ? 'failed' : 'idle', message: session.notesError || '' });
  const [error, setError] = useState(''), [confirm, setConfirm] = useState(false), [elapsed, setElapsed] = useState(0);
  const statusVersion = useRef(0), mounted = useRef(true), lock = useRef(false);
  const running = status.state === 'running';
  useEffect(() => {
    mounted.current = true; const version = statusVersion.current;
    const unsubscribe = window.speakbridge.onEvent(event => {
      if (event.type !== 'notes-progress') return;
      const next = event.payload as NotesStatus;
      if (next.id === session.id) { statusVersion.current++; setStatus(next); }
    });
    window.speakbridge.notesStatus(session.id).then(next => { if (mounted.current && version === statusVersion.current) setStatus(next); }).catch(() => {});
    return () => { mounted.current = false; unsubscribe(); };
  }, [session.id]);
  useEffect(() => {
    let live = true;
    window.speakbridge.notesPlan(session.id, language).then(value => { if (live) { setPlan(value); setError(''); } }).catch(e => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [session.id, language]);
  useEffect(() => { onBusy(running); return () => onBusy(false); }, [running, onBusy]);
  useEffect(() => {
    if (!running) return;
    const tick = () => setElapsed(Math.max(0, Math.floor((Date.now() - (status.startedAt || Date.now())) / 1000)));
    tick(); const timer = setInterval(tick, 1000); return () => clearInterval(timer);
  }, [running, status.startedAt]);
  async function generate() {
    if (lock.current || running) return;
    lock.current = true; setError(''); setConfirm(false); statusVersion.current++;
    setStatus({ id: session.id, state: 'running', startedAt: Date.now(), message: '正在准备资料…' });
    try {
      const value = await window.speakbridge.makeNotes(session.id, language); onUpdate(value);
      if (mounted.current) setStatus({ id: session.id, state: 'completed', message: '纪要已生成并保存。', language: value.notesLanguage });
    } catch (e) {
      if (mounted.current) { const message = (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, ''); setStatus({ id: session.id, state: 'failed', message }); }
    } finally { lock.current = false; }
  }
  const failure = error || (['failed', 'cancelled'].includes(status.state) ? status.message : '');
  return <section className="meeting-notes" aria-label="会议纪要生成">
    <div className="notes-controls">
      <label className="form-label">纪要语言<select value={language} disabled={running} onChange={e => setLanguage(e.target.value as NotesLanguage)}>
        <option value="auto">自动 · 跟随会议原文</option><option value="zh">简体中文</option><option value="ja">日本語</option><option value="en">English</option>
      </select></label>
      <div className="notes-plan">{plan && <>
        <strong>{language === 'auto' ? `自动识别：${languages[plan.language]}` : `输出：${languages[plan.language]}`}</strong>
        <span>{plan.model} · {plan.contextTokens ? `${plan.contextTokens.toLocaleString()} token 上下文` : '上下文容量由服务端判断'}</span>
        <span>输入估算约 {plan.inputTokens.toLocaleString()} token · 本次输出预算 {plan.outputTokens.toLocaleString()} token</span>
        <span>{plan.mode === 'direct' ? '完整提交原文' : '超过模型容量，将按 token 预算分段整理'} · 估算并非精确计数，以服务端为准</span>
      </>}</div>
    </div>
    {running && <div className="notes-progress" role="status" aria-live="polite">
      <LoaderCircle size={20} className="spin" /><div><strong>{status.message}</strong>{status.stage === 'chunk' && status.total && <span>第 {(status.completed || 0) + 1} / {status.total} 部分</span>}<span>已等待 {Math.floor(elapsed / 60)} 分 {elapsed % 60} 秒 · 关闭详情后会继续处理</span></div>
      <button className="small-button" onClick={() => window.speakbridge.cancelNotes(session.id).catch(e => setError(e.message))}>停止生成</button>
    </div>}
    {failure && <div className="notes-error" role="alert"><strong>本次未生成完整纪要</strong><p>{failure}</p><span>转写原文和已有纪要均保留。可调整语言、模型预算后重试。</span></div>}
    {session.notes ? <MarkdownNotes text={session.notes} /> : <div className="notes-empty"><Sparkles size={28} /><h3>让重点一目了然</h3><p>跟随原文语言，整理概况、议题、决定和行动项。<br />未提供的信息标为“不明 / 待定”，不凭空补充。</p></div>}
    <div className="notes-actions">
      {!running && (confirm ? <><span>成功后才替换已有纪要。</span><button className="primary compact" disabled={disabled || !!error} onClick={generate}>确认重新生成</button><button className="small-button" onClick={() => setConfirm(false)}>取消</button></> : <button className="primary compact" disabled={disabled || !!error || !session.segments.some(s => s.text)} onClick={() => session.notes ? setConfirm(true) : void generate()}>{session.notes ? <RotateCcw size={17} /> : <Sparkles size={17} />}{session.notes ? '重新生成' : failure ? '重试生成会议纪要' : '生成会议纪要'}</button>)}
      {status.state === 'completed' && <span className="connected">纪要已生成并保存</span>}
    </div>
  </section>;
}

export function NotesBudgetSettings({ settings, onChange }: { settings: Settings; onChange: (value: Settings) => void }) {
  return <details className="notes-budget"><summary>纪要模型预算与超时</summary><p className="field-help">0 表示按模型自动配置。DeepSeek Flash / V4 Pro 标称上下文为 1,000,000 token；自定义代理或本地模型可填写其实际容量。输入长度不再按统一字数限制。</p><div className="form-grid">
    <label className="form-label">上下文容量（token，0 = 自动）<input type="number" min="0" max="10000000" step="1" value={settings.notesContextTokens} onChange={e => onChange({ ...settings, notesContextTokens: Number(e.target.value) })} /></label>
    <label className="form-label">纪要输出预算（token，0 = 自动）<input type="number" min="0" max="10000000" step="1" value={settings.notesOutputTokens} onChange={e => onChange({ ...settings, notesOutputTokens: Number(e.target.value) })} /></label>
    <label className="form-label">单次纪要请求超时（秒）<input type="number" min="30" max="1800" step="1" value={settings.notesTimeoutSeconds} onChange={e => onChange({ ...settings, notesTimeoutSeconds: Number(e.target.value) })} /></label>
  </div><p className="field-help">上下文包含原文、提示词和输出；自动模式会预留空间，实际 token 数取决于模型。DeepSeek 纪要使用非思考模式，将预算留给正文。自动输出预算达到上限时，仅在模型有余量时提高预算重试一次；手动预算不会自动增加。</p></details>;
}
