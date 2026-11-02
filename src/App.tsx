import { useCallback, useEffect, useRef, useState } from 'react';
import { AudioLines, ArrowUpRight, BookOpen, Check, ChevronDown, CircleHelp, ClipboardList, Clock3, Command, FileText, Headphones, History, Home, Languages, LoaderCircle, Mic, Monitor, Play, Plus, Settings2, ShieldCheck, Square, Subtitles, X } from 'lucide-react';
import { AudioCapture } from './audio';
import { EmptyState, HistoryList, SessionDialog, SettingsPage, Transcript } from './components';
import { DictationPage, DictationShortcuts } from './Dictation';
import { dateTime, duration, languages, sourceNames, engineNames, modelNames, type Bootstrap, type Session, type SessionState, type Settings } from './types';

type Page = 'home' | 'dictionary' | 'shortcuts' | 'meetings' | 'realtime' | 'history' | 'settings' | 'dictation';
const nav = [
  { id: 'home', label: '首页', icon: Home },
  { id: 'dictionary', label: '个人词典', icon: BookOpen },
  { id: 'shortcuts', label: '快捷键', icon: Command },
  { id: 'meetings', label: '会议纪要', icon: ClipboardList },
  { id: 'realtime', label: '实时翻译', icon: Mic },
  { id: 'dictation', label: '语音输入', icon: AudioLines },
  { id: 'history', label: '会话历史', icon: History },
] as const;
const initialState: SessionState = { status: 'idle', session: null, error: '' };
function cleanError(error: unknown) { return (error instanceof Error ? error.message : String(error)).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, ''); }

export default function App() {
  const [boot, setBoot] = useState<Bootstrap>();
  const [settings, setSettings] = useState<Settings>();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [state, setState] = useState(initialState);
  const [page, setPage] = useState<Page>('realtime');
  const [toast, setToast] = useState('');
  const [loadError, setLoadError] = useState('');
  const [selected, setSelected] = useState<Session | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [level, setLevel] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [overlay, setOverlay] = useState(false);
  const [word, setWord] = useState('');
  const [saveBusy, setSaveBusy] = useState(false);
  const capture = useRef<AudioCapture | null>(null);
  const action = useRef<() => void>(() => {});
  const dictate = useRef<(payload: { token: string; settings: Settings }) => void>(() => {});
  const finishDictation = useRef<() => void>(() => {});
  const dictationJob = useRef<{ token: string; recorder: AudioCapture; ready: boolean; stopRequested: boolean; pending: Uint8Array[]; pendingBytes: number; started: Promise<void>; resolveStarted: () => void; finish?: Promise<void> } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const active = state.status !== 'idle';
  const notify = useCallback((message: string) => { setToast(message); clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setToast(''), 6500); }, []);
  useEffect(() => {
    window.speakbridge.bootstrap().then(data => { setBoot(data); setSettings(data.settings); setSessions(data.sessions); setState(data.state); }).catch(error => setLoadError(cleanError(error)));
    const unsubscribe = window.speakbridge.onEvent(event => {
      if (event.type === 'session') { const next = event.payload as SessionState; setState(next); if (next.status === 'idle') { void capture.current?.stop(); capture.current = null; if (dictationJob.current) { dictationJob.current.stopRequested = true; dictationJob.current = null; } } }
      if (event.type === 'history') { const next = event.payload as Session[]; setSessions(next); setSelected(previous => previous ? next.find(value => value.id === previous.id) || null : null); }
      if (event.type === 'capture-stop') { if (dictationJob.current) dictationJob.current.stopRequested = true; void capture.current?.stop(); capture.current = null; }
      if (event.type === 'toggle-recording') action.current();
      if (event.type === 'overlay') setOverlay(event.payload as boolean);
      if (event.type === 'dictation-start') dictate.current(event.payload as { token: string; settings: Settings });
      if (event.type === 'dictation-end') finishDictation.current();
      if (event.type === 'dictation-readiness') setBoot(previous => previous ? { ...previous, dictation: event.payload as Bootstrap['dictation'] } : previous);
      if (event.type === 'dictation-feedback') setBoot(previous => previous ? { ...previous, dictationFeedback: event.payload as Bootstrap['dictationFeedback'] } : previous);
      if (event.type === 'dictation-page') setPage('dictation');
      if (event.type === 'notice') notify(String(event.payload));
    });
    return () => { unsubscribe(); void capture.current?.stop(); clearTimeout(toastTimer.current); };
  }, []);
  useEffect(() => {
    const tick = () => setElapsed(state.session ? (state.status === 'recording' ? Date.now() - state.session.startedAt : state.session.durationMs) : 0);
    tick(); const timer = setInterval(tick, 1000); return () => clearInterval(timer);
  }, [state.status, state.session?.id, state.session?.durationMs]);
  const closeDialog = useCallback(() => setSelected(null), []);
  async function endSession() {
    if (dictationJob.current) return finishDictationJob();
    try { await capture.current?.stop(); capture.current = null; await window.speakbridge.stop(); }
    catch (error) { notify(cleanError(error)); }
  }
  async function beginSession(demo = false) {
    if (!settings || preparing || active) return;
    setPreparing(true); setPage('realtime');
    try {
      if (!demo) {
        try { await window.speakbridge.checkEngines(settings); } catch (error) { setPage('settings'); throw error; }
        const recorder = new AudioCapture(bytes => window.speakbridge.audio(bytes), setLevel, () => { notify('音频来源已停止，会话将自动保存。'); void endSession(); });
        capture.current = recorder;
        await recorder.prepare(settings);
      }
      await window.speakbridge.saveSettings(settings);
      await window.speakbridge.start({ demo, settings });
      capture.current?.begin();
    } catch (error) { await capture.current?.stop(); capture.current = null; notify(cleanError(error)); }
    finally { setPreparing(false); }
  }
  action.current = () => { if (state.status === 'recording') void endSession(); else if (!active && !preparing) void beginSession(); };
  async function finishDictationJob() {
    const job = dictationJob.current;
    if (!job) { if (state.session?.mode === 'dictation') await window.speakbridge.stop(); return; }
    job.stopRequested = true;
    if (job.finish) return job.finish;
    job.finish = (async () => {
      // Release ends microphone capture even if the model is still loading.
      await job.recorder.stop();
      await job.started;
      if (job.ready) await window.speakbridge.stop();
      if (dictationJob.current === job) dictationJob.current = null;
    })().catch(error => notify(cleanError(error)));
    return job.finish;
  }
  dictate.current = async ({ token, settings: speechSettings }) => {
    if (dictationJob.current || preparing || active) { await window.speakbridge.cancelDictation(); return; }
    setPreparing(true);
    let resolveStarted!: () => void;
    const started = new Promise<void>(resolve => { resolveStarted = resolve; });
    const recorder = new AudioCapture(bytes => {
      if (job.ready) window.speakbridge.audio(bytes);
      else {
        job.pendingBytes += bytes.byteLength;
        if (job.pendingBytes > 48000 * 30) { void window.speakbridge.cancelDictation('模型准备超过 30 秒，请在语音输入页面先准备模型。'); void finishDictationJob(); return; }
        job.pending.push(bytes);
      }
    }, value => { setLevel(value); window.speakbridge.dictationLevel(value); }, () => { void window.speakbridge.cancelDictation().then(finishDictationJob); });
    const job = { token, recorder, ready: false, stopRequested: false, pending: [] as Uint8Array[], pendingBytes: 0, started, resolveStarted };
    dictationJob.current = job; capture.current = recorder;
    try {
      await recorder.prepare(speechSettings);
      if (job.stopRequested) { await window.speakbridge.cancelDictation(); return; }
      // Queue PCM locally until the ASR is ready, so first words survive startup.
      recorder.begin();
      await window.speakbridge.start({ demo: false, settings: speechSettings, dictationToken: token });
      job.ready = true;
      for (const bytes of job.pending) window.speakbridge.audio(bytes);
      job.pending = []; job.pendingBytes = 0;
    } catch (error) {
      await recorder.stop(); capture.current = null;
      if (!job.stopRequested) { await window.speakbridge.cancelDictation(cleanError(error)); notify(cleanError(error)); }
      else await window.speakbridge.cancelDictation();
    } finally {
      job.resolveStarted(); setPreparing(false);
      if (!job.ready && dictationJob.current === job) dictationJob.current = null;
    }
  };
  finishDictation.current = () => { void finishDictationJob(); };
  async function toggleOverlay() { try { await window.speakbridge.showOverlay(!overlay); } catch (error) { notify(cleanError(error)); } }
  function updateSession(value: Session) { setSessions(previous => previous.map(s => s.id === value.id ? value : s)); setSelected(previous => previous?.id === value.id ? value : previous); }
  async function star(session: Session) { try { const value = await window.speakbridge.updateSession(session.id, { starred: !session.starred }); setSessions(previous => previous.map(s => s.id === value.id ? value : s)); } catch (error) { notify(cleanError(error)); } }
  async function remove(id: string) { setSessions(await window.speakbridge.deleteSession(id)); setSelected(previous => previous?.id === id ? null : previous); notify('这条会话已删除'); }
  async function removeNotes(id: string) { updateSession(await window.speakbridge.deleteNotes(id)); notify('这份纪要已删除，转写和翻译已保留'); }
  async function removeMany(ids: string[], notesOnly = false) {
    const next = await (notesOnly ? window.speakbridge.deleteNotesMany(ids) : window.speakbridge.deleteSessions(ids));
    setSessions(next); setSelected(previous => previous ? next.find(row => row.id === previous.id) || null : null);
    notify(notesOnly ? `已删除 ${ids.length} 份纪要，转写和翻译已保留` : `已删除 ${ids.length} 条会话`);
  }
  async function saveDictionary(next: string[]) { if (!settings) return; setSaveBusy(true); try { setSettings(await window.speakbridge.saveSettings({ ...settings, dictionary: next })); setWord(''); notify('个人词典已更新'); } catch (error) { notify(cleanError(error)); } finally { setSaveBusy(false); } }
  if (!boot || !settings) return <div className="loading-screen">{loadError ? <><h2>无法载入本地数据</h2><p>{loadError}</p></> : <><AudioLines size={38} /><p>正在打开声桥…</p></>}</div>;
  const change = <K extends keyof Settings>(key: K, value: Settings[K]) => setSettings({ ...settings, [key]: value });
  const recorded = sessions.filter(s => !s.demo);

  return <div className={'app-shell platform-' + boot.platform}>
    <div className="titlebar"><span>SpeakBridge</span><span className="titlebar-caption">让对话，自在发生</span></div>
    <aside className="sidebar">
      <div className="brand"><span className="brand-symbol"><AudioLines size={23} strokeWidth={2.5} /></span><span>声桥<span className="brand-en">SpeakBridge</span></span></div>
      <nav aria-label="主导航">{nav.map((item, i) => <div key={item.id} className={i === 3 ? 'nav-section' : ''}><button className={'nav-item ' + (page === item.id ? 'active' : '')} onClick={() => setPage(item.id)}><item.icon size={20} strokeWidth={1.7} /><span>{item.label}</span>{item.id === 'realtime' && <span className={'nav-dot ' + (active ? 'live' : '')} />}</button></div>)}</nav>
      <div className="sidebar-bottom"><div className="local-card"><span className="local-card-icon"><Headphones size={20} /></span><strong>听懂每一种声音</strong><p>开会、学习、看视频<br />让语言不再是距离。</p><button onClick={() => beginSession(true)} disabled={active || preparing}>体验演示 <ArrowUpRight size={14} /></button></div><button className={'nav-item settings-nav ' + (page === 'settings' ? 'active' : '')} onClick={() => setPage('settings')}><Settings2 size={19} /><span>设置</span>{(settings.hasKey || settings.hasSonioxKey) && <span className="configured-dot" />}</button><div className="workspace"><span className="workspace-avatar">声</span><div><strong>本地工作空间</strong><span>v{boot.appVersion} · {boot.platform === 'darwin' ? 'macOS' : 'Windows'}</span></div><ShieldCheck size={17} /></div></div>
    </aside>
    <main className={'main-content ' + (active && page === 'realtime' ? 'recording-layout' : '')}>
      {page === 'dictation' && <DictationPage boot={boot} settings={settings} state={state} preparing={preparing} notify={notify} onStop={endSession} onSettings={() => setPage('settings')} onShortcuts={() => setPage('shortcuts')} />}
      {page === 'realtime' && <>
        <header className="page-header"><div><span className="eyebrow">REAL-TIME TRANSLATION</span><h1>实时翻译</h1><p>边说边转写，让每一句话都被听懂。</p></div><span className="service-status"><i />{settings.speechProvider === 'soniox' ? 'Soniox · 付费转写' : settings.speechProvider === 'api' || (settings.speechProvider === 'auto' && settings.hasKey) ? 'API 转写' : '本地 ' + modelNames[settings.localModel]}</span></header>
        <div className="mode-grid" role="group" aria-label="显示方式">
          <button className={'mode-card ' + (settings.viewMode === 'transcript' ? 'selected' : '')} aria-pressed={settings.viewMode === 'transcript'} disabled={active} onClick={() => change('viewMode', 'transcript')}><span className="mode-icon"><FileText size={23} strokeWidth={1.7} /></span><span><strong>转写记录</strong><small>在声桥中阅读，专注每一场对话。</small></span>{settings.viewMode === 'transcript' && <span className="mode-check"><Check size={12} /></span>}</button>
          <button className={'mode-card ' + (settings.viewMode === 'subtitle' ? 'selected' : '')} aria-pressed={settings.viewMode === 'subtitle'} disabled={active} onClick={() => change('viewMode', 'subtitle')}><span className="mode-icon"><Subtitles size={24} strokeWidth={1.7} /></span><span><strong>悬浮字幕</strong><small>置顶于其他应用，会议和视频都适用。</small></span>{settings.viewMode === 'subtitle' && <span className="mode-check"><Check size={12} /></span>}</button>
        </div>
        <div className="session-settings"><div className="setting-row"><span><Mic size={18} />音频来源</span><label className="pill-select"><select aria-label="音频来源" disabled={active || preparing} value={settings.audioSource} onChange={e => change('audioSource', e.target.value as Settings['audioSource'])}>{Object.entries(sourceNames).map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select><ChevronDown size={15} /></label></div><div className="setting-row"><span><Languages size={18} />语言</span><div className="language-controls"><label className="pill-select"><select aria-label="源语言" disabled={active || preparing} value={settings.sourceLanguage} onChange={e => change('sourceLanguage', e.target.value)}><option value="auto">自动识别</option>{Object.entries(languages).map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select><ChevronDown size={15} /></label><span className="language-arrow">→</span><label className="pill-select"><select aria-label="翻译目标" disabled={active || preparing} value={settings.targetLanguage} onChange={e => change('targetLanguage', e.target.value)}><option value="off">关闭翻译</option>{Object.entries(languages).map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select><ChevronDown size={15} /></label></div></div></div>
        {state.error && <div className="error-banner" role="alert"><CircleHelp size={18} /><span>{state.error}</span></div>}
        <button className={'primary start-button ' + (state.status === 'recording' ? 'recording' : '')} disabled={preparing || state.status === 'connecting' || state.status === 'stopping'} onClick={() => active ? endSession() : beginSession()}>
          {preparing || state.status === 'connecting' || state.status === 'stopping' ? <LoaderCircle size={20} className="spin" /> : active ? <Square size={17} fill="currentColor" /> : <Mic size={20} />}
          {preparing ? '正在准备会话…' : state.status === 'connecting' ? '正在准备语音引擎…' : state.status === 'stopping' ? '正在完成转写并保存…' : active ? `结束${state.session?.demo ? '演示' : '会话'}` : '开始会话'}
          {!active && !preparing && <kbd>{boot.platform === 'darwin' ? '⌘' : 'Ctrl'} ⇧ Space</kbd>}{active && <span className="button-duration">{duration(elapsed)}</span>}
        </button>
        <div className="session-footnote"><span><ShieldCheck size={13} />记录保存在本机 · 原始音频不落盘</span><button className="text-button" disabled={active || preparing} onClick={() => beginSession(true)}><Play size={12} />先体验演示</button></div>
        {active && state.session ? <section className="live-panel"><div className="live-heading"><h2><i className="record-dot" />{state.session.demo ? '演示会话' : '正在聆听'}</h2><div className="live-tools"><div className="volume-meter" aria-label="音量"><span style={{ width: Math.min(100, level * 600) + '%' }} /></div><button className="small-button" onClick={toggleOverlay}><Monitor size={15} />{overlay ? '隐藏字幕' : '显示字幕'}</button></div></div><Transcript session={state.session} live /><div className="live-bottom">{state.session.demo ? '演示使用预设文本，没有录音或网络请求。' : `${state.session.engines ? (state.session.engines.speech === 'local' && state.session.speechModel ? modelNames[state.session.speechModel] : engineNames[state.session.engines.speech]) + ' → ' + engineNames[state.session.engines.text] + ' · ' : ''}${sourceNames[state.session.audioSource]} · ${state.session.targetLanguage === 'off' ? '仅转写' : '翻译为' + languages[state.session.targetLanguage]}`}</div></section> : <HistoryList sessions={sessions.slice(0, 5)} onOpen={setSelected} onStar={star} onDelete={remove} busyId={active ? state.session?.id : undefined} />}
        <div className="page-bottom"><span>跨越语言，连接彼此。</span><span>声桥 SPEAKBRIDGE</span></div>
      </>}
      {page === 'home' && <><header className="page-header"><div><span className="eyebrow">YOUR CONVERSATIONS, CONNECTED</span><h1>让沟通，没有距离。</h1><p>每一次倾听，都是理解的开始。</p></div></header><div className="home-hero"><div><span className="tag">你的跨语言工作空间</span><h2>从声音，到理解。</h2><p>实时转写，双语翻译，悬浮字幕。<br />把注意力留给对话，其他交给声桥。</p><button className="primary compact" onClick={() => setPage('realtime')}><Mic size={18} />开始一场对话</button></div><div className="hero-wave" aria-hidden="true">{[20, 40, 70, 100, 65, 40, 85, 120, 85, 45, 65, 90, 50, 28, 18].map((h, i) => <i key={i} style={{ height: h }} />)}</div></div><div className="stats-grid"><div><span>已保存会话</span><strong>{recorded.length}<small>场</small></strong></div><div><span>累计对话时长</span><strong>{Math.round(recorded.reduce((n, s) => n + s.durationMs, 0) / 60000)}<small>分钟</small></strong></div><div><span>个人词典</span><strong>{settings.dictionary.length}<small>个词条</small></strong></div></div><HistoryList sessions={sessions.slice(0, 5)} onOpen={setSelected} onStar={star} onDelete={remove} busyId={active ? state.session?.id : undefined} heading="最近的对话" /></>}
      {page === 'history' && <><header className="page-header"><div><span className="eyebrow">EVERY WORD, REMEMBERED</span><h1>会话历史</h1><p>把有价值的对话，留给未来的自己。</p></div></header><HistoryList sessions={sessions} onOpen={setSelected} onStar={star} onDelete={remove} onDeleteMany={removeMany} busyId={active ? state.session?.id : undefined} heading="全部会话" full /></>}
      {page === 'meetings' && <><header className="page-header"><div><span className="eyebrow">LESS NOTE-TAKING, MORE LISTENING</span><h1>会议纪要</h1><p>从完整对话中，找到真正重要的事。</p></div></header><div className="info-card"><ClipboardList size={22} /><div><strong>把转写，整理成下一步行动。</strong><p>打开一条会话，切换到「会议纪要」，即可生成讨论要点、决定和待办。</p></div></div><HistoryList sessions={sessions} onOpen={setSelected} onStar={star} onDelete={removeNotes} onDeleteMany={ids => removeMany(ids, true)} deleteMode="notes" busyId={active ? state.session?.id : undefined} heading="选择一场会话" full /></>}
      {page === 'dictionary' && <><header className="page-header"><div><span className="eyebrow">WORDS THAT MATTER TO YOU</span><h1>个人词典</h1><p>让声桥更懂你的专业术语、人名和产品名称。</p></div></header><div className="dictionary-card"><label htmlFor="new-word">添加常用词</label><form onSubmit={e => { e.preventDefault(); if (word.trim()) saveDictionary([...settings.dictionary, word.trim()]); }}><input id="new-word" value={word} onChange={e => setWord(e.target.value)} maxLength={80} placeholder="例如：SpeakBridge、需求评审、田中さん" disabled={active} /><button className="primary compact" disabled={!word.trim() || saveBusy || active}><Plus size={17} />添加</button></form><p>这些词用于 Qwen3-ASR 本地识别、API 识别和翻译提示。增强模式的 Qwen3-ASR 分支也会参考词典。以上两种模式的词典合计最多 256 字节（约 85 个汉字），请优先放重要名称。SenseVoice / Whisper 本地识别不使用词典；词典是提示，不会强制替换原文。</p></div><div className="section-heading"><h2>我的词条<span className="count">{settings.dictionary.length} / 100</span></h2></div>{settings.dictionary.length ? <div className="word-list">{settings.dictionary.map(text => <span className="word-chip" key={text}>{text}<button aria-label={'删除词条 ' + text} disabled={saveBusy || active} onClick={() => saveDictionary(settings.dictionary.filter(t => t !== text))}><X size={15} /></button></span>)}</div> : <EmptyState title="从一个熟悉的词开始" detail="添加领域术语，让每一次识别更准确。" />}</>}
      {page === 'shortcuts' && <><header className="page-header"><div><span className="eyebrow">A LITTLE FASTER, A LOT EASIER</span><h1>快捷键</h1><p>不打断思路，也能掌控对话。</p></div></header><DictationShortcuts boot={boot} disabled={active || preparing} notify={notify} /><div className="shortcut-list"><div><span><Mic size={19} />开始 / 结束会话</span><kbd>{boot.platform === 'darwin' ? '⌘' : 'Ctrl'} + Shift + Space</kbd></div><div><span><Subtitles size={19} />显示 / 隐藏悬浮字幕</span><kbd>{boot.platform === 'darwin' ? '⌘' : 'Ctrl'} + Shift + L</kbd></div><div><span><X size={19} />关闭会话详情</span><kbd>Esc</kbd></div></div><div className="info-card"><CircleHelp size={20} /><p>{boot.shortcutAvailable ? '录音与字幕快捷键在其他应用处于前台时也可使用。首次录音仍需允许系统权限。' : '录音快捷键已被其他应用占用。请使用页面上的开始按钮。'}</p></div></>}
      {page === 'settings' && (active ? <div className="info-card"><Mic size={22} /><div><h2>会话进行中</h2><p>结束会话后即可修改服务和音频设置。</p><button className="small-button" onClick={() => setPage('realtime')}>返回实时翻译</button></div></div> : <SettingsPage settings={settings} onChange={setSettings} onSaved={setSettings} notify={notify} dataDirectory={boot.dataDirectory} />)}
    </main>
    {toast && <div className="toast" role="status"><span>{toast}</span><button aria-label="关闭提示" onClick={() => setToast('')}><X size={16} /></button></div>}
    {selected && <SessionDialog session={selected} onClose={closeDialog} onUpdate={updateSession} onDelete={remove} onDeleteNotes={removeNotes} disabled={active && state.session?.id === selected.id} initialTab={page === 'meetings' ? 'notes' : 'transcript'} notify={notify} />}
  </div>;
}
