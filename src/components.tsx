import { memo, useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, Check, ChevronRight, Clock3, Copy, FileText, Flag, Mic, Search, Sparkles, Trash2, X, RotateCcw, LoaderCircle, ShieldCheck, KeyRound, Settings2 } from 'lucide-react';
import { dateTime, duration, languages, sourceNames, type Session, type Settings, type Capabilities, type Segment } from './types';
import { LiveText } from './LiveText';
import { hasSpeechText } from './text-motion';
import { useFollowScroll } from './useFollowScroll';
import { DeleteButton } from './DeleteButton';
import { MarkdownNotes } from './MarkdownNotes';

export function EmptyState({ title, detail }: { title: string; detail: string }) {
  return <div className="empty-state"><div className="empty-icon"><FileText size={24} strokeWidth={1.5} /></div><h3>{title}</h3><p>{detail}</p></div>;
}
export function HistoryList({ sessions, onOpen, onStar, onDelete, onDeleteMany, deleteMode = 'session', busyId, heading = '历史记录', full = false }: { sessions: Session[]; onOpen: (session: Session) => void; onStar: (session: Session) => void; onDelete: (id: string) => Promise<void>; onDeleteMany?: (ids: string[]) => Promise<void>; deleteMode?: 'session' | 'notes'; busyId?: string; heading?: string; full?: boolean }) {
  const [query, setQuery] = useState('');
  const [starred, setStarred] = useState(false);
  const [selection, setSelection] = useState<string[]>([]);
  const [deleting, setDeleting] = useState(false);
  const allCheckbox = useRef<HTMLInputElement>(null);
  const bulkLock = useRef(false);
  const selectable = full && !!onDeleteMany;
  const filtered = sessions.filter(session => (!starred || session.starred) && [session.title, ...session.segments.map(row => row.text + (row.translation || ''))].some(text => text.toLocaleLowerCase().includes(query.toLocaleLowerCase())));
  const eligible = filtered.filter(session => session.id !== busyId && (deleteMode !== 'notes' || !!session.notes)).map(session => session.id);
  const eligibleKey = JSON.stringify(eligible);
  const selected = selection.filter(id => eligible.includes(id));
  const allSelected = eligible.length > 0 && selected.length === eligible.length;
  useEffect(() => {
    const allowed = new Set<string>(JSON.parse(eligibleKey));
    setSelection(previous => previous.every(id => allowed.has(id)) ? previous : previous.filter(id => allowed.has(id)));
  }, [eligibleKey]);
  useEffect(() => { if (allCheckbox.current) allCheckbox.current.indeterminate = selected.length > 0 && !allSelected; }, [selected.length, allSelected]);
  async function deleteSelected() {
    if (!onDeleteMany || !selected.length || bulkLock.current) return;
    bulkLock.current = true; setDeleting(true);
    try { await onDeleteMany([...selected]); setSelection([]); }
    finally { bulkLock.current = false; setDeleting(false); }
  }
  return <section className="history-section">
    <div className="section-heading"><h2>{heading}<span className="count">{sessions.length}</span></h2><div className="history-tools">{full && <button className={'icon-button ' + (starred ? 'selected' : '')} title="只看收藏" aria-label="只看收藏" aria-pressed={starred} disabled={deleting} onClick={() => { setStarred(!starred); setSelection([]); }}><Flag size={17} fill={starred ? 'currentColor' : 'none'} /></button>}<label className="search-box"><Search size={17} /><input aria-label="搜索历史记录" value={query} disabled={deleting} onChange={e => { setQuery(e.target.value); setSelection([]); }} placeholder="搜索会话" /></label></div></div>
    {selectable && sessions.length > 0 && <div className={'history-selection ' + (selected.length ? 'has-selection' : '')}>
      <label className="select-all"><input ref={allCheckbox} type="checkbox" checked={allSelected} disabled={deleting || !eligible.length} onChange={() => setSelection(allSelected ? [] : eligible)} />{query || starred ? '全选当前结果' : '全选'}</label>
      <span className="selection-count" role="status">{selected.length ? `已选 ${selected.length} 条` : `${eligible.length} 条可选`}</span>
      {!!selected.length && <button className="small-button" disabled={deleting} onClick={() => setSelection([])}>取消选择</button>}
      <span className="selection-scope">{deleteMode === 'notes' ? '只删除纪要，保留转写和翻译' : '删除会话及其转写、翻译和纪要'}{filtered.some(row => row.id === busyId) ? ' · 进行中的会话不可选' : ''}</span>
      {!!selected.length && <DeleteButton key={deleteMode + JSON.stringify(selected)} label={`删除所选 ${selected.length} ${deleteMode === 'notes' ? '份纪要' : '条会话'}`} buttonText={`删除所选（${selected.length}）`} description={deleteMode === 'notes' ? `删除所选 ${selected.length} 份纪要？转写和翻译会保留。` : `删除所选 ${selected.length} 条会话及其转写、翻译和纪要？此操作无法撤销。`} onDelete={deleteSelected} />}
    </div>}
    {!filtered.length ? <EmptyState title={query || starred ? '没有找到匹配的会话' : '每一次对话，都值得留存'} detail={query || starred ? '换个关键词，或取消收藏筛选。' : '结束会话后，转写和翻译会自动保存在这里。'} /> : <div className="history-list">{filtered.map(session => <div className="history-row" key={session.id} data-session-id={session.id}>
      {selectable && <label className="history-select" title={session.id === busyId ? '会话进行中，结束后可选择' : deleteMode === 'notes' && !session.notes ? '这条会话还没有纪要' : '选择这条记录'}><input type="checkbox" aria-label={'选择' + (deleteMode === 'notes' ? '纪要：' : '会话：') + session.title} checked={selected.includes(session.id)} disabled={deleting || !eligible.includes(session.id)} onChange={event => setSelection(previous => event.target.checked ? [...previous, session.id] : previous.filter(id => id !== session.id))} /></label>}
      <button className="history-open" disabled={deleting} onClick={() => onOpen(session)}><span className="history-icon"><Mic size={21} strokeWidth={1.6} /></span><span className="history-text"><span className="history-title">{session.title}{session.demo && <span className="tag">演示</span>}{session.status === 'interrupted' && <span className="tag warning">已中断</span>}</span><span className="history-meta">{dateTime(session.startedAt)}<span>·</span>{session.demo ? '示例会话' : sourceNames[session.audioSource]}<Clock3 size={13} />{duration(session.durationMs)}</span></span></button>
      <div className="history-row-actions"><button className={'icon-button star ' + (session.starred ? 'selected' : '')} aria-label={session.starred ? '取消收藏' : '收藏会话'} disabled={deleting} onClick={() => onStar(session)}><Flag size={16} fill={session.starred ? 'currentColor' : 'none'} /></button><button className="icon-button" aria-label="查看会话" disabled={deleting} onClick={() => onOpen(session)}><ChevronRight size={19} /></button>
      {deleteMode === 'notes' && !session.notes ? <span className="no-notes">暂无纪要</span> : <DeleteButton label={(deleteMode === 'notes' ? '删除纪要：' : '删除会话：') + session.title} description={deleteMode === 'notes' ? '只删除这份纪要，保留转写和翻译。' : '删除这条会话及其转写、翻译和纪要？'} disabled={deleting || busyId === session.id} onDelete={() => onDelete(session.id)} />}</div>
    </div>)}</div>}
  </section>;
}
const TranscriptRow = memo(function TranscriptRow({ id, text, translation, startMs, final, pending, error, translationError, live, translate }: Segment & { live: boolean; translate: boolean }) {
  return <article className={'transcript-row ' + (!final ? 'partial' : '')} data-segment-id={id}>
    <time>{duration(startMs)}<span className={'row-activity ' + (!final && live ? 'active' : '')} aria-hidden="true" /></time>
    <div className="transcript-copy"><p className="original-text"><LiveText text={text} animate={live} settled={final} />{!text && pending && <span className="recognition-wait">正在聆听</span>}<span className={'live-caret ' + (!final && live ? 'active' : '')} aria-hidden="true" /></p>
      {translate && (live || translation) && <div className="translation-slot"><p className="translated-text"><LiveText text={translation} animate={live} /></p>{live && final && text && !translation && !translationError && <span className="translation-pending">正在翻译…</span>}</div>}
      {error && <p className="row-error">{error}</p>}{translationError && <p className="row-error">{translationError}</p>}
    </div>
  </article>;
});
export const Transcript = memo(function Transcript({ session, live = false }: { session: Session; live?: boolean }) {
  const scroll = useFollowScroll(live, session.id);
  const rows = session.segments.filter(row => hasSpeechText(row.text) || row.error || row.pending);
  return <div className={'transcript-shell ' + (live ? 'transcript-live' : '')}>
    <div className="transcript" data-follow={scroll.paused ? 'paused' : 'active'} ref={scroll.viewport} onScroll={scroll.onScroll} onWheel={scroll.onWheel} onKeyDown={scroll.onKeyDown} onPointerDown={scroll.onPointerDown} tabIndex={0} aria-label="转写内容">
      <div ref={scroll.content} className="transcript-content">
        {!rows.length ? <div className="listening-empty"><div className="listening-bars">{[0, 1, 2, 3, 4].map(i => <i key={i} style={{ animationDelay: i * .12 + 's' }} />)}</div><p>{live ? '准备好了，说点什么吧' : '这次会话没有转写内容'}</p><span>{live ? '你的声音，即刻成为文字' : '请确认音频来源、权限和麦克风输入。'}</span></div> : rows.map(row => <TranscriptRow key={row.id} {...row} live={live} translate={session.targetLanguage !== 'off'} />)}
      </div>
    </div>
    {live && scroll.paused && <button className="follow-latest" onClick={scroll.resume}>↓ 回到最新</button>}
  </div>;
});
export function SessionDialog({ session, onClose, onUpdate, onDelete, onDeleteNotes, disabled = false, initialTab = 'transcript', notify }: { session: Session; onClose: () => void; onUpdate: (session: Session) => void; onDelete: (id: string) => Promise<void>; onDeleteNotes: (id: string) => Promise<void>; disabled?: boolean; initialTab?: string; notify: (message: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [title, setTitle] = useState(session.title);
  const [busy, setBusy] = useState('');
  const [tab, setTab] = useState(initialTab);
  const [regenerate, setRegenerate] = useState(false);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    ref.current?.focus();
    const listener = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'Tab') {
        const nodes = [...ref.current!.querySelectorAll<HTMLElement>('button:not(:disabled), input, select, [tabindex="0"]')];
        if (!nodes.length) return;
        if (event.shiftKey && (document.activeElement === nodes[0] || document.activeElement === ref.current)) { event.preventDefault(); nodes.at(-1)!.focus(); }
        else if (!event.shiftKey && document.activeElement === nodes.at(-1)) { event.preventDefault(); nodes[0].focus(); }
      }
    };
    document.addEventListener('keydown', listener);
    return () => { document.removeEventListener('keydown', listener); previous?.focus(); };
  }, [onClose]);
  async function run(name: string, action: () => Promise<void>) { setBusy(name); try { await action(); } catch (error) { notify(error instanceof Error ? error.message : '操作失败'); } finally { setBusy(''); } }
  return <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}><div role="dialog" aria-modal="true" aria-label="会话详情" className="session-dialog" tabIndex={-1} ref={ref}>
    <div className="dialog-heading"><span className="eyebrow">{session.demo ? '演示会话' : '会话记录'}</span><button className="icon-button" aria-label="关闭详情" onClick={onClose}><X size={20} /></button></div>
    <input className="title-input" aria-label="会话标题" value={title} maxLength={120} onChange={e => setTitle(e.target.value)} onBlur={() => { if (title.trim() && title !== session.title) window.speakbridge.updateSession(session.id, { title }).then(onUpdate).catch(error => notify(String(error))); }} />
    <div className="detail-meta">{dateTime(session.startedAt)}<span>·</span><Clock3 size={14} />{duration(session.durationMs)}<span>·</span>{session.segments.filter(s => s.text).length} 段转写</div>
    <div className="dialog-tools"><div className="segmented"><button className={tab === 'transcript' ? 'active' : ''} onClick={() => setTab('transcript')}>转写与翻译</button><button className={tab === 'notes' ? 'active' : ''} onClick={() => setTab('notes')}>会议纪要</button></div><div className="toolbar-actions"><button className="small-button" disabled={!!busy} onClick={() => run('copy', async () => { await window.speakbridge.copySession(session.id); notify('已复制会话文本'); })}><Copy size={15} />复制</button><label className="export-select"><ArrowDownToLine size={15} /><select aria-label="导出会话" defaultValue="" disabled={!!busy} onChange={e => { const format = e.target.value; e.target.value = ''; if (format) run('export', async () => { if (await window.speakbridge.exportSession(session.id, format)) notify('已导出会话'); }); }}><option value="" disabled>导出</option><option value="txt">文本 .txt</option><option value="md">Markdown .md</option><option value="srt">字幕 .srt</option></select></label></div></div>
    {tab === 'transcript' ? <Transcript session={session} /> : session.notes ? <MarkdownNotes text={session.notes} /> : <div className="notes-empty"><Sparkles size={28} /><h3>让重点一目了然</h3><p>按日语议事录模板整理概要、议题、决定与待办。<br />资料中不明确的信息标注为「不明」或「未定」。</p><button className="primary compact" disabled={!!busy || disabled || !session.segments.some(s => s.text)} onClick={() => run('notes', async () => onUpdate(await window.speakbridge.makeNotes(session.id)))}>{busy === 'notes' ? <LoaderCircle className="spin" size={17} /> : <Sparkles size={17} />}生成会议纪要</button></div>}
    <div className="dialog-footer"><span className="muted">{busy ? '正在处理…' : disabled ? '会话进行中，结束后可删除。' : '已保存在本机'}</span><div className="toolbar-actions">{session.segments.some(s => s.translationError || (s.text && !s.translation && session.targetLanguage !== 'off')) && !session.demo && <button className="small-button" disabled={!!busy || disabled} onClick={() => run('retry', async () => onUpdate(await window.speakbridge.retryTranslation(session.id)))}><RotateCcw size={14} />重试翻译</button>}
      {tab === 'notes' && session.notes && (regenerate ? <div className="notes-regenerate"><span>按新模板重新生成？成功后替换现有纪要。</span><button className="small-button" disabled={!!busy || disabled} onClick={() => run('notes', async () => { onUpdate(await window.speakbridge.makeNotes(session.id)); setRegenerate(false); })}>{busy === 'notes' ? '正在生成…' : '确认重新生成'}</button><button className="small-button" disabled={!!busy} onClick={() => setRegenerate(false)}>取消</button></div> : <button className="small-button" disabled={!!busy || disabled || !session.segments.some(s => s.text)} onClick={() => setRegenerate(true)}><Sparkles size={14} />重新生成</button>)}
      {tab === 'notes' ? session.notes && <DeleteButton key={'notes-' + session.id} label="删除这份纪要" description="只删除纪要，保留这条会话的转写和翻译。" disabled={!!busy || disabled} onDelete={() => onDeleteNotes(session.id)} /> : <DeleteButton key={session.id} label="删除这条会话" description="删除这条会话及其转写、翻译和纪要？" disabled={!!busy || disabled} onDelete={() => onDelete(session.id)} />}
    </div></div>
  </div></div>;
}

export function SettingsPage({ settings, onChange, onSaved, notify, dataDirectory }: { settings: Settings; onChange: (settings: Settings) => void; onSaved: (settings: Settings) => void; notify: (message: string) => void; dataDirectory: string }) {
  const [key, setKey] = useState('');
  const [sonioxKey, setSonioxKey] = useState('');
  const [busy, setBusy] = useState('');
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [capabilities, setCapabilities] = useState<Capabilities>();
  const [progress, setProgress] = useState('');
  useEffect(() => {
    window.speakbridge.detectEngines().then(setCapabilities).catch(() => {});
    return window.speakbridge.onEvent(event => { if (event.type === 'model-progress') { const p = event.payload as { status: string; file?: string; progress?: number }; setProgress(p.status === 'progress' ? `${p.file || '模型'} · ${Math.round(p.progress || 0)}%` : p.status === 'ready' ? '模型已就绪' : '正在下载 / 加载模型…'); } });
  }, []);
  useEffect(() => { navigator.mediaDevices.enumerateDevices().then(items => setDevices(items.filter(d => d.kind === 'audioinput'))).catch(() => {}); }, []);
  function field<K extends keyof Settings>(name: K, value: Settings[K]) { onChange({ ...settings, [name]: value }); }
  async function save(test = false) {
    setBusy(test ? 'test' : 'save');
    try { const saved = await window.speakbridge.saveSettings({ ...settings, ...(key.trim() ? { apiKey: key } : {}), ...(sonioxKey.trim() ? { sonioxApiKey: sonioxKey } : {}) }); onSaved(saved); setKey(''); setSonioxKey(''); setCapabilities(await window.speakbridge.detectEngines()); if (test) { await window.speakbridge.testConnection(); notify('语音与翻译服务连接成功'); } else notify('设置已保存'); }
    catch (error) { notify(error instanceof Error ? error.message : '设置保存失败'); }
    finally { setBusy(''); }
  }
  return <><header className="page-header"><div><span className="eyebrow">MAKE IT YOURS</span><h1>设置</h1><p>连接你的服务，让每一次对话更顺畅。</p></div></header>
    <div className="settings-section"><h2><Settings2 size={20} />引擎选择</h2><p className="settings-intro">自动模式优先使用 OpenAI 兼容 API Key；Soniox 需主动选择。没有密钥时，使用所选本地语音模型 + Codex / Claude Code。随后尝试 DeepSeek Harness 和 Ollama。</p>
      <div className="form-grid"><label className="form-label">语音转写引擎<select value={settings.speechProvider} onChange={e => field('speechProvider', e.target.value as Settings['speechProvider'])}><option value="auto">自动选择</option><option value="api">OpenAI 兼容 API · 实时转写</option><option value="soniox">Soniox · 边听边修订（付费）</option><option value="local">本地模型 · 人声检测与转写</option></select></label><label className="form-label">翻译与纪要引擎<select value={settings.textProvider} onChange={e => field('textProvider', e.target.value as Settings['textProvider'])}><option value="auto">自动选择</option><option value="api">云端 API</option><option value="codex">Codex CLI · 使用已有登录</option><option value="claude">Claude Code · 使用已有登录</option><option value="deepseek">DeepSeek Harness · 使用已有配置</option><option value="ollama">Ollama · 本机模型</option><option value="harness">自定义 Harness</option></select></label></div>
      <div className="engine-detection"><span>{capabilities?.codex ? '✓ Codex 已检测到' : '○ 未检测到 Codex'}</span><span>{capabilities?.claude ? '✓ Claude Code 已检测到' : '○ 未检测到 Claude Code'}</span><span>{capabilities?.deepseek ? '✓ DeepSeek Harness 已检测到' : '○ 未检测到 DeepSeek Harness'}</span><span>{capabilities?.localModels?.[settings.localModel] ? '✓ 所选语音模型已下载' : '○ 所选语音模型尚未下载'}</span></div>
      <p className="field-help">Codex / Claude Code 通常仍调用云端并使用你的账户额度，请先在终端登录。本地语音模型 + 本机 Ollama 模型可完全离线；CLI 按语音段翻译，延迟会更高。服务报错会明确提示，不会自动改用另一个账户。</p>
      {['codex', 'claude'].includes(settings.textProvider) && <label className="form-label">{settings.textProvider === 'codex' ? 'Codex' : 'Claude Code'} 程序路径（可留空自动检测）<input value={settings.textProvider === 'codex' ? settings.codexPath : settings.claudePath} onChange={e => field(settings.textProvider === 'codex' ? 'codexPath' : 'claudePath', e.target.value)} placeholder={settings.textProvider === 'codex' ? capabilities?.codex || '填写绝对路径' : capabilities?.claude || '填写绝对路径'} spellCheck={false} /></label>}
      {settings.textProvider === 'deepseek' && <><label className="form-label">DeepSeek Harness 程序路径（可留空自动检测）<input value={settings.deepseekPath} onChange={e => field('deepseekPath', e.target.value)} placeholder={capabilities?.deepseek || 'dsh 可执行文件或 lib/bin.js 的绝对路径'} spellCheck={false} /></label><label className="form-label">DeepSeek Harness 配置目录（可留空）<input value={settings.deepseekHome} onChange={e => field('deepseekHome', e.target.value)} placeholder="默认使用 DSH_HOME 或用户目录下的 .dsh" spellCheck={false} /></label><p className="field-help">使用官方 dsh headless，读取已有模型设置和凭证。它仍需要有效的模型服务配置，并非免密钥模型。仅处理文字，关闭工具调用；临时会话在任务结束后清理，不写入你的 Harness 历史。</p></>}
      {['ollama', 'auto'].includes(settings.textProvider) && <div className="form-grid"><label className="form-label">本机 Ollama 地址<input value={settings.ollamaUrl} onChange={e => field('ollamaUrl', e.target.value)} spellCheck={false} /></label><label className="form-label">已下载的 Ollama 模型<input value={settings.ollamaModel} onChange={e => field('ollamaModel', e.target.value)} spellCheck={false} /></label></div>}
      {settings.textProvider === 'harness' && <><label className="form-label">Harness 可执行文件<input value={settings.harnessPath} onChange={e => field('harnessPath', e.target.value)} placeholder="绝对路径，不包含参数" spellCheck={false} /></label><label className="form-label">启动参数（JSON 数组）<input value={settings.harnessArgs} onChange={e => field('harnessArgs', e.target.value)} placeholder={'["--text-only"]'} spellCheck={false} /></label><p className="field-help">程序从 stdin 读取一行 JSON：instructions、input；向 stdout 输出纯文本。日志写 stderr。请使用只处理文字的可信适配器，不会自动套用 Shell。</p></>}
      <label className="form-label">本地识别模型<select value={settings.localModel} disabled={!!busy} onChange={e => field('localModel', e.target.value as Settings['localModel'])}><option value="ensemble">增强识别 · 三模型复核，推荐 16 GB 内存</option><option value="qwen3-asr">Qwen3-ASR 1.7B · 多语言与个人词典</option><option value="whisper-turbo">Whisper Large v3 Turbo · 日语与多语言</option><option value="sensevoice">SenseVoice · 轻量快速</option><option value="whisper-base">Whisper Base · 更多语言兼容</option></select></label>
      <div className="model-download"><div><strong>{{ ensemble: '增强识别 · 三模型复核', 'qwen3-asr': 'Qwen3-ASR 1.7B', 'whisper-turbo': 'Whisper Large v3 Turbo', sensevoice: 'SenseVoice', 'whisper-base': 'Whisper Base' }[settings.localModel] + ' + Silero 人声检测'}</strong><p>{{ ensemble: '首次下载约 3.7 GB，推荐至少 16 GB 内存。初稿与三模型复核分开运行，复核期间继续显示下一句；定稿稍慢。', 'qwen3-asr': '首次下载约 2.4 GB，建议至少 8 GB 内存。支持中日英等语言，个人词典可参与识别。', 'whisper-turbo': '首次下载约 1.04 GB，适合日语等多语言；本地识别不使用个人词典。', sensevoice: '首次下载约 240 MB，支持中文、日语、英语、韩语和粤语，资源占用较低，约每 0.8 秒尝试更新初稿。', 'whisper-base': '首次下载约 80 MB，更多语言的轻量兼容选项。' }[settings.localModel]}下载后离线运行，长句保留重叠音频。增强模式 / Qwen3-ASR / Whisper Turbo 至少等候 1.2 秒停顿后定稿，以保留完整语句，期间仍显示预览。速度和准确率因设备、语言及录音而异。</p>{progress && <span className="field-help" role="status">{progress}</span>}</div><button className="small-button" disabled={!!busy} onClick={async () => { setBusy('model'); setProgress('开始下载 / 加载…'); try { const saved = await window.speakbridge.saveSettings({ ...settings, ...(key.trim() ? { apiKey: key } : {}), ...(sonioxKey.trim() ? { sonioxApiKey: sonioxKey } : {}) }); onSaved(saved); setKey(''); setSonioxKey(''); setCapabilities(await window.speakbridge.prepareModel()); setProgress('模型已就绪'); notify('本地语音模型已就绪'); } catch (error) { setProgress(''); notify(error instanceof Error ? error.message : '模型加载失败'); } finally { setBusy(''); } }}>{busy === 'model' && <LoaderCircle size={16} className="spin" />}{capabilities?.localModels?.[settings.localModel] ? '检查 / 修复模型' : '下载语音模型'}</button></div>
    </div>
    <div className="settings-section"><h2><KeyRound size={20} />Soniox 实时转写</h2><p className="settings-intro">持续识别音频，自动修订尚未确认的文字。需独立购买 Soniox API 额度；音频发送到 Soniox，翻译与纪要仍使用上方所选文字引擎。</p>
      <label className="form-label">Soniox API Key <span className={settings.hasSonioxKey ? 'connected' : 'muted'}>{settings.hasSonioxKey ? '已加密保存' : '尚未配置'}</span><input type="password" value={sonioxKey} onChange={e => setSonioxKey(e.target.value)} placeholder="粘贴 Soniox API Key" autoComplete="off" spellCheck={false} /></label>
      {settings.sonioxKeyError && <p className="row-error">{settings.sonioxKeyError}</p>}
      <p className="field-help">连接 Soniox 官方服务，使用 stt-rt-v5。个人词典参与识别。保存不会发起收费请求；测试连接会发送 0.1 秒静音音频并测试所选翻译引擎，可能产生费用。</p>
      <div className="settings-actions"><button className="small-button" disabled={!!busy} onClick={() => save()}>保存 Soniox 设置</button>{settings.hasSonioxKey && <button className="text-button" disabled={!!busy} onClick={async () => { try { onSaved(await window.speakbridge.saveSettings({ ...settings, sonioxApiKey: '' })); setSonioxKey(''); notify('Soniox 密钥已移除'); } catch (error) { notify(String(error)); } }}>移除 Soniox 密钥</button>}</div>
    </div>
    <div className="settings-section"><h2><KeyRound size={20} />OpenAI 兼容服务</h2><p className="settings-intro">选择 OpenAI 兼容语音引擎或云端文字引擎时，音频 / 文本发送到此服务。使用本地引擎可留空密钥。</p>
      <label className="form-label">API Key <span className={settings.hasKey ? 'connected' : 'muted'}>{settings.hasKey ? '已加密保存' : '尚未配置'}</span><input type="password" value={key} onChange={e => setKey(e.target.value)} placeholder={settings.hasKey ? '已保存；填写新密钥可替换' : '粘贴你的 API Key'} autoComplete="off" spellCheck={false} /></label>
      {settings.keyError && <p className="row-error">{settings.keyError}</p>}
      <label className="form-label">API 地址<input value={settings.baseUrl} onChange={e => field('baseUrl', e.target.value)} placeholder="https://api.openai.com/v1" spellCheck={false} /></label>
      <div className="form-grid"><label className="form-label">实时转写模型<input value={settings.transcriptionModel} onChange={e => field('transcriptionModel', e.target.value)} spellCheck={false} /></label><label className="form-label">翻译 / 纪要模型<input value={settings.translationModel} onChange={e => field('translationModel', e.target.value)} spellCheck={false} /></label></div>
      <p className="field-help">默认连接 OpenAI。自定义服务需同时支持 Realtime 转写和 Responses API。</p>
      <div className="settings-actions"><button className="primary compact" disabled={!!busy} onClick={() => save()}>{busy === 'save' ? <LoaderCircle size={16} className="spin" /> : <Check size={16} />}保存设置</button><button className="small-button" disabled={!!busy} onClick={() => save(true)}>{busy === 'test' && <LoaderCircle size={15} className="spin" />}保存并测试连接</button>{settings.hasKey && <button className="text-button" disabled={!!busy} onClick={async () => { try { onSaved(await window.speakbridge.saveSettings({ ...settings, apiKey: '' })); notify('API Key 已移除'); } catch (error) { notify(String(error)); } }}>移除密钥</button>}</div>
    </div>
    <div className="settings-section"><h2><Settings2 size={20} />音频与字幕</h2><div className="form-grid"><label className="form-label">麦克风<select value={settings.microphoneId} onChange={e => field('microphoneId', e.target.value)}><option value="">系统默认麦克风</option>{devices.filter(d => d.deviceId && d.deviceId !== 'default').map((device, i) => <option key={device.deviceId} value={device.deviceId}>{device.label || `麦克风 ${i + 1}`}</option>)}</select></label><label className="form-label">语音停顿分段<select value={settings.silenceMs} onChange={e => field('silenceMs', +e.target.value)}><option value={400}>400 ms · 更快</option><option value={700}>700 ms · 均衡</option><option value={1200}>1200 ms · 更完整</option></select></label><label className="form-label">语音检测灵敏度<select value={settings.speechThreshold} onChange={e => field('speechThreshold', +e.target.value)}><option value={.006}>高 · 适合轻声说话</option><option value={.012}>标准</option><option value={.025}>低 · 减少背景噪声触发</option></select></label><label className="form-label">悬浮字幕字号<select value={settings.subtitleFontSize} onChange={e => field('subtitleFontSize', +e.target.value)}>{[18, 20, 24, 28, 32, 36, 40].map(n => <option key={n} value={n}>{n} px</option>)}</select></label></div><button className="small-button" disabled={!!busy} onClick={() => save()}>保存偏好</button></div>
    <div className="privacy-note"><ShieldCheck size={20} /><div><strong>记录留在你的设备上</strong><p>只保存转写和翻译，不保存原始录音。密钥使用系统加密存储。<br />数据目录：<span className="data-path">{dataDirectory}</span></p></div></div>
  </>;
}
