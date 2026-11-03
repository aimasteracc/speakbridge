import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, AudioLines, Check, CheckCircle2, ChevronDown, Copy, Keyboard, LoaderCircle, Mic, Settings2, ShieldCheck, Square, X } from 'lucide-react';
import { LiveText } from './LiveText';
import { DeleteButton } from './DeleteButton';
import { duration, modelNames, type CleanupProvider, type Bootstrap, type DictationFeedback, type DictationPreferences, type DictationReadiness, type SessionState, type Settings } from './types';

const errorText = (error: unknown) => String(error instanceof Error ? error.message : error).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '');
const holdName = (key: DictationPreferences['holdKey'], platform: string) => ({ fn: 'fn', rightalt: platform === 'darwin' ? '右 Option' : '右 Alt', rightctrl: '右 Ctrl', off: '未启用' })[key];
const shortcutName = (key: string, platform: string) => key === 'off' ? '未启用' : key.replace('CommandOrControl', platform === 'darwin' ? '⌘' : 'Ctrl').replace(/\+/g, ' + ');
function words(state: SessionState) { return state.session?.mode === 'dictation' ? state.session.segments.map(row => row.text).filter(Boolean).join(' ') : ''; }
const cleanupNames: Record<CleanupProvider, string> = { off: '原文直出 · 最快', ollama: '智能整理 · 本地 Ollama', api: '智能整理 · API', codex: '智能整理 · Codex', claude: '智能整理 · Claude Code', deepseek: '智能整理 · DeepSeek Harness', harness: '智能整理 · 自定义 Harness' };
function cleanupDescription(provider: CleanupProvider, settings: Settings) {
  if (provider === 'off') return '识别后直接输入，不调用文字模型。';
  if (provider === 'ollama') return `使用本机 Ollama 的 ${settings.ollamaModel}。需先启动服务并下载这个模型，整理效果取决于模型能力。`;
  if (provider === 'api') return `识别文字与词典将发送至 ${new URL(settings.baseUrl).host}，使用 ${settings.translationModel}，按服务用量收费。`;
  if (provider === 'codex') return '识别文字与词典将通过 Codex CLI 发送至 OpenAI，使用已有登录与额度。';
  if (provider === 'claude') return '识别文字与词典将通过 Claude Code 发送至其配置的模型服务，使用已有登录与额度。';
  return '识别文字与词典将交给已配置的 Harness，数据去向和费用取决于其模型服务设置。';
}

function useDictationReadiness(boot: Bootstrap, active: boolean) {
  const [readiness, setReadiness] = useState(boot.dictation);
  const [pressed, setPressed] = useState(false);
  const activeRef = useRef(active); activeRef.current = active;
  const refresh = useCallback(async () => {
    if (!activeRef.current) setReadiness(await window.speakbridge.dictationStatus(false));
  }, []);
  useEffect(() => {
    const check = () => { void refresh().catch(() => {}); };
    check(); window.addEventListener('focus', check);
    const unsubscribe = window.speakbridge.onEvent(event => {
      if (event.type === 'dictation-readiness') setReadiness(event.payload as DictationReadiness);
      if (event.type === 'dictation-key') setPressed(event.payload === true);
    });
    return () => { window.removeEventListener('focus', check); unsubscribe(); };
  }, [refresh]);
  return { readiness, setReadiness, pressed };
}

export function DictationShortcuts({ boot, disabled = false, notify }: { boot: Bootstrap; disabled?: boolean; notify: (message: string) => void }) {
  const { readiness, setReadiness, pressed } = useDictationReadiness(boot, disabled);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const preferences = readiness.preferences;
  async function change(patch: Partial<DictationPreferences>) {
    setSaving(true); setError('');
    try { setReadiness(await window.speakbridge.saveDictationPreferences({ ...preferences, ...patch })); notify('快捷键已更新'); }
    catch (cause) { setError(errorText(cause)); }
    finally { setSaving(false); }
  }
  return <section className="dictation-shortcuts" aria-label="语音输入快捷键">
    <div className="dictation-shortcut-row"><span className="dictation-shortcut-icon"><Mic size={20} /></span><div><h2>按住说话</h2><p>按住开始录音，松开后自动输入。</p></div><label className="dictation-select"><select aria-label="按住说话快捷键" disabled={disabled || saving} value={preferences.holdKey} onChange={event => void change({ holdKey: event.target.value as DictationPreferences['holdKey'] })}>{boot.platform === 'darwin' && <option value="fn">fn / 🌐</option>}<option value="rightalt">{boot.platform === 'darwin' ? '右 Option' : '右 Alt'}</option><option value="rightctrl">右 Ctrl</option><option value="off">关闭</option></select><ChevronDown size={15} /></label></div>
    <div className="dictation-shortcut-row"><span className="dictation-shortcut-icon"><AudioLines size={20} /></span><div><h2>免持听写</h2><p>按一下开始，再按一下结束。适合长段口述。</p></div><label className="dictation-select"><select aria-label="免持听写快捷键" disabled={disabled || saving} value={preferences.handsFreeShortcut} onChange={event => void change({ handsFreeShortcut: event.target.value })}>{['CommandOrControl+Shift+D', 'F8', 'CommandOrControl+Alt+D'].map(key => <option key={key} value={key}>{shortcutName(key, boot.platform)}</option>)}<option value="off">关闭</option></select><ChevronDown size={15} /></label></div>
    <div className={'dictation-key-test ' + (pressed ? 'pressed' : '')} role="status"><Keyboard size={16} /><span>{saving ? '正在保存…' : pressed ? '已检测到按键 · 松开即可结束' : preferences.holdKey === 'off' ? '按住说话已关闭，可使用免持听写。' : readiness.holdAvailable ? `按住 ${holdName(preferences.holdKey, boot.platform)}，这里会显示按键反馈。` : '按住说话尚未就绪，请到语音输入页面完成权限准备。'}</span></div>
    {error && <p className="dictation-inline-error" role="alert">{error}</p>}
    {preferences.holdKey === 'fn' && boot.platform === 'darwin' && <p className="dictation-shortcut-note">Fn / 🌐 也可能用于系统听写、输入法或表情；有冲突时可换用右 Option。<button className="text-button" disabled={disabled || saving} onClick={() => void change({ holdKey: 'rightalt' })}>改用右 Option</button></p>}
    {preferences.handsFreeShortcut !== 'off' && !readiness.handsFreeAvailable && <p className="dictation-inline-error" role="alert">免持快捷键被占用，请换一个快捷键。</p>}
    {preferences.holdKey === 'rightalt' && boot.platform !== 'darwin' && <p className="dictation-shortcut-note">如果右 Alt 用于输入特殊字符，请改用右 Ctrl。</p>}
    {preferences.holdKey === 'off' && preferences.handsFreeShortcut === 'off' && <p className="dictation-inline-error" role="status">两种听写方式都已关闭。启用一个快捷键即可继续使用。</p>}
  </section>;
}

export function DictationPage({ boot, settings, state, preparing, notify, onStop, onSettings, onShortcuts }: {
  boot: Bootstrap; settings: Settings; state: SessionState; preparing: boolean; notify: (message: string) => void; onStop: () => void; onSettings: () => void; onShortcuts?: () => void;
}) {
  const inserting = boot.dictationFeedback?.phase === 'inserting';
  const active = state.status !== 'idle' || preparing || inserting;
  const { readiness, setReadiness, pressed } = useDictationReadiness(boot, active);
  const [checking, setChecking] = useState(false);
  const [checkMessage, setCheckMessage] = useState('');
  const [micVerified, setMicVerified] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [savingCleanup, setSavingCleanup] = useState(false);
  const [cleanupError, setCleanupError] = useState('');
  const session = state.session?.mode === 'dictation' ? state.session : null;
  const { preferences } = readiness;
  const cleanupProvider = preferences.cleanupProvider || 'off';
  async function changeCleanup(provider: CleanupProvider) {
    setSavingCleanup(true); setCleanupError('');
    try { setReadiness(await window.speakbridge.saveDictationPreferences({ ...preferences, cleanupProvider: provider })); notify('听写输出方式已更新'); }
    catch (error) { setCleanupError(errorText(error)); }
    finally { setSavingCleanup(false); }
  }
  const microphoneReady = !['denied', 'restricted'].includes(readiness.microphonePermission) && (readiness.microphonePermission === 'granted' || micVerified);
  const holdEnabled = preferences.holdKey !== 'off';
  const shortcutReady = holdEnabled ? readiness.holdAvailable : readiness.handsFreeAvailable;
  const ready = microphoneReady && readiness.inputAvailable && readiness.modelInstalled && shortcutReady;
  const permissionNeeded = !microphoneReady || !readiness.inputAvailable;
  const primaryKey = holdEnabled ? holdName(preferences.holdKey, boot.platform) : shortcutName(preferences.handsFreeShortcut, boot.platform);
  useEffect(() => { setMicVerified(false); }, [settings.microphoneId]);
  async function prepare() {
    setChecking(true); setCheckMessage('正在检查麦克风…');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: settings.microphoneId ? { deviceId: { exact: settings.microphoneId } } : true, video: false });
      stream.getTracks().forEach(track => track.stop()); setMicVerified(true);
      setCheckMessage('正在检查输入权限…');
      const checked = await window.speakbridge.dictationStatus(true); setReadiness(checked);
      if (!checked.inputAvailable) { setCheckMessage(checked.message || '在系统设置中允许辅助功能，然后回到这里。'); return; }
      if (!checked.modelInstalled) { setCheckMessage('还需要下载语音模型。打开语音模型设置即可完成。'); return; }
      setCheckMessage('正在准备本地语音模型，首次可能需要稍等…');
      const warmed = await window.speakbridge.warmDictation(); setReadiness(warmed);
      const selectedModeReady = warmed.preferences.holdKey !== 'off' ? warmed.holdAvailable : warmed.handsFreeAvailable;
      setCheckMessage(selectedModeReady ? '准备好了。回到你要输入文字的应用，使用快捷键即可。' : warmed.message || '当前听写方式尚未就绪，请检查快捷键，或开启免持听写。');
    } catch (error) {
      const message = error instanceof DOMException && error.name === 'NotAllowedError' ? '麦克风权限未开启，请在系统隐私设置中允许声桥使用麦克风。' : error instanceof DOMException && error.name === 'NotFoundError' ? '未找到麦克风，请连接设备或在设置中选择其他麦克风。' : errorText(error);
      setCheckMessage(message); notify(message);
    }
    finally { setChecking(false); }
  }
  return <>
    <header className="page-header"><div><span className="eyebrow">YOUR VOICE, WHERE YOU WRITE</span><h1>语音输入</h1><p>在任何输入框，把想说的直接说出来。</p></div><span className={'service-status ' + (ready ? 'ready' : '')}><i />{ready ? '权限已就绪' : permissionNeeded ? '待授权' : '尚未就绪'}</span></header>
    <section className="dictation-hero">
      <span className="dictation-hero-label"><Mic size={15} />{holdEnabled ? '按住说话' : '免持听写'}</span>
      <h2>{!ready ? permissionNeeded ? '先完成权限准备。' : '当前听写方式尚未就绪。' : holdEnabled ? '按住说，松开就输入。' : '按一下开始，再按一下输入。'}</h2>
      <div className={'dictation-key-wrap ' + (pressed ? 'pressed' : '')}><kbd className="dictation-key">{primaryKey}</kbd><span role="status">{pressed ? '正在按住 · 松开即可结束' : !ready ? '完成下方准备后，这个快捷键才能正常听写' : holdEnabled ? '按住这个键，开始说话' : '在目标应用里使用快捷键'}</span></div>
      <div className="dictation-steps" aria-label="语音输入使用步骤"><span><i>1</i>点一下输入框</span><ArrowRight size={14} /><span><i>2</i>{holdEnabled ? '按住快捷键说话' : '按快捷键说话'}</span><ArrowRight size={14} /><span><i>3</i>{holdEnabled ? '松开，文字就位' : '再次按键，文字就位'}</span></div>
      <div className="dictation-hero-bottom"><span>{holdEnabled && preferences.handsFreeShortcut !== 'off' ? <>长段口述也可以用 <kbd>{shortcutName(preferences.handsFreeShortcut, boot.platform)}</kbd> 免持听写</> : '无需回到声桥，关闭主窗口后仍可使用快捷键。'}</span><button className="text-button" disabled={active} onClick={() => onShortcuts ? onShortcuts() : setShowShortcuts(value => !value)}><Settings2 size={13} />修改快捷键</button></div>
    </section>
    {showShortcuts && <DictationShortcuts boot={boot} disabled={active} notify={notify} />}
    <section className="dictation-setup" aria-label="听写准备">
      <div className="dictation-setup-heading"><div><h2>{ready ? '随时可以开始' : '第一次使用，先准备一下'}</h2><p>{ready ? '关闭主窗口后，声桥仍会留在菜单栏或托盘。' : '检查一次权限，之后直接在目标应用里说话。'}</p></div><button className={ready ? 'small-button' : 'primary compact'} disabled={active || checking} onClick={() => void prepare()}>{checking ? <LoaderCircle size={16} className="spin" /> : ready ? <CheckCircle2 size={16} /> : <Mic size={16} />}{checking ? '正在准备…' : ready ? '重新检查' : '准备开始'}</button></div>
      <div className="dictation-readiness">{[
        { label: '麦克风', ok: microphoneReady, detail: microphoneReady ? '已允许' : '待允许' },
        { label: '自动输入', ok: readiness.inputAvailable, detail: readiness.inputAvailable ? '已就绪' : '待检查' },
        { label: '本地模型', ok: readiness.modelInstalled, detail: readiness.modelReady ? '已准备' : readiness.modelInstalled ? '已安装' : '待下载' },
        { label: holdEnabled ? '按住说话' : '免持听写', ok: shortcutReady, detail: shortcutReady ? '快捷键已就绪' : '快捷键未就绪' },
      ].map(item => <div className={item.ok ? 'ready' : ''} key={item.label}>{item.ok ? <Check size={14} /> : <span className="dictation-step-dot" />}<span>{item.label}<small>{item.detail}</small></span></div>)}</div>
      {(checkMessage || !ready && readiness.message) && <p className="dictation-setup-message" role="status">{checkMessage || readiness.message}</p>}
      {!readiness.modelInstalled && <button className="text-button" disabled={active || checking} onClick={onSettings}>下载语音模型<ArrowRight size={13} /></button>}
      {preferences.holdKey !== 'off' && !readiness.holdAvailable && readiness.handsFreeAvailable && readiness.inputAvailable && microphoneReady && readiness.modelInstalled && <p className="dictation-setup-message">按住说话尚未就绪，可以先用 {shortcutName(preferences.handsFreeShortcut, boot.platform)} 免持听写。</p>}
      <button className="small-button" disabled={active || !readiness.inputAvailable} onClick={() => window.speakbridge.armDictationInput('test').catch(error => notify(errorText(error)))}><Keyboard size={15} />测试自动输入（不录音）</button>
    </section>
    <section className="dictation-cleanup" aria-label="听写输出方式" aria-busy={savingCleanup}>
      <div className="dictation-cleanup-heading"><div><h2><label htmlFor="dictation-cleanup-provider">听写输出</label></h2><p>尝试清理口头禅、重复和明确的自我纠正，原文始终保留。</p></div><select id="dictation-cleanup-provider" aria-describedby="dictation-cleanup-description" disabled={active || savingCleanup} value={cleanupProvider} onChange={event => void changeCleanup(event.target.value as CleanupProvider)}>{Object.entries(cleanupNames).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
      <p id="dictation-cleanup-description">{cleanupDescription(cleanupProvider, settings)}</p>
      {cleanupProvider !== 'off' && <p>结束后会多一步整理，最多等待 15 秒；失败时保留原文供你检查。整理不能找回漏听的内容。<button className="text-button" disabled={active || savingCleanup} onClick={onSettings}>配置整理引擎</button></p>}
      {cleanupError && <p className="error-banner" role="alert">{cleanupError}</p>}
    </section>
    {session && <section className="dictation-result" aria-label="听写结果" aria-busy={active}><div className="section-heading"><h2>{inserting ? '正在输入…' : boot.dictationFeedback?.phase === 'polishing' ? '正在整理表达…' : active ? state.status === 'stopping' ? '正在完成听写…' : '正在聆听' : '这次听写'}</h2><span className="muted">{session.dictation?.targetName || '手动复制'}</span></div><div className="dictation-text"><LiveText text={active ? words(state) : session.dictation?.text || ''} settled={!active} /></div><p className="dictation-feedback" role="status">{inserting ? '正在完成输入，请稍等。' : boot.dictationFeedback?.phase === 'polishing' ? '正在整理表达，可随时取消。' : session.dictation?.message}</p>
      {!active && session.dictation?.cleanup && <details className="dictation-original"><summary>{session.dictation.cleanup.status === 'applied' ? '已整理 · 查看识别原文' : session.dictation.cleanup.status === 'unchanged' ? '已检查，原文无需整理' : '整理未完成 · 查看识别原文'}</summary><p>{session.dictation.rawText}</p><button className="small-button" onClick={() => window.speakbridge.copyDictation('original').then(() => notify('识别原文已复制')).catch(error => notify(errorText(error)))}><Copy size={15} aria-hidden="true" />复制识别原文</button></details>}
      {!active && session.dictation?.diagnostics && ['retained', 'sent'].includes(session.dictation.status) && <details className="dictation-diagnostics"><summary>查看输入诊断</summary><p>目标应用：{session.dictation.targetName || '未确认'}<br />阶段：{session.dictation.diagnostics.stage === 'capture' ? '定位输入框' : '写入文字'}<br />输入控件：{session.dictation.diagnostics.role || '未取得'}{session.dictation.diagnostics.subrole ? ` / ${session.dictation.diagnostics.subrole}` : ''}<br />结果代码：{session.dictation.diagnostics.code || 'UNKNOWN'}</p></details>}
      <div className="dictation-actions">{state.status === 'recording' && <button className="primary compact" onClick={onStop}><Square size={15} />结束听写</button>}{active && !inserting && <button className="small-button" onClick={() => window.speakbridge.cancelDictation().catch(error => notify(errorText(error)))}><X size={15} />取消</button>}{!active && session.dictation?.retryable && <button className="primary compact" onClick={() => window.speakbridge.armDictationInput('retry').catch(error => notify(errorText(error)))}><ArrowRight size={15} />选择输入框并填入</button>}{!active && session.dictation?.text && <button className="small-button" onClick={() => window.speakbridge.copyDictation().then(() => notify('听写文字已复制')).catch(error => notify(errorText(error)))}><Copy size={15} />复制文字</button>}{!active && <DeleteButton key={session.id} label="清除这次听写结果" description="清除声桥中的这次结果，已输入其他应用的文字会保留。" onDelete={async () => { await window.speakbridge.clearDictation(session.id); notify('这次听写结果已清除'); }} />}</div></section>}
    {state.error && <div className="error-banner" role="alert">{state.error}</div>}
    <div className="dictation-privacy"><ShieldCheck size={17} /><div><strong>{modelNames[settings.localModel]} · 音频仅在本机识别</strong><p>仅使用麦克风，不保存听写历史，不自动按回车发送。每次最长 2 分钟。{cleanupProvider !== 'off' && cleanupDescription(cleanupProvider, settings)}</p></div><button className="text-button" disabled={active} onClick={onSettings}>语音模型设置</button></div>
  </>;
}

export function DictationOverlay() {
  const [state, setState] = useState<SessionState>({ status: 'idle', session: null, error: '' });
  const [feedback, setFeedback] = useState<DictationFeedback>();
  const [platform, setPlatform] = useState('darwin');
  const [preferences, setPreferences] = useState<DictationPreferences>({ holdKey: 'rightalt', handsFreeShortcut: 'CommandOrControl+Shift+D', cleanupProvider: 'off' });
  const [message, setMessage] = useState('');
  const [level, setLevel] = useState(0);
  const [now, setNow] = useState(Date.now());
  const lastLevel = useRef(0);
  useEffect(() => {
    let mounted = true, receivedState = false, receivedFeedback = false;
    document.body.classList.add('overlay-body');
    window.speakbridge.bootstrap().then(data => {
      if (!mounted) return;
      if (!receivedState) setState(data.state);
      if (!receivedFeedback) setFeedback(data.dictationFeedback);
      setPlatform(data.platform); setPreferences(data.dictation.preferences);
    }).catch(error => setMessage(errorText(error)));
    const unsubscribe = window.speakbridge.onEvent(event => {
      if (event.type === 'session') { receivedState = true; setState(event.payload as SessionState); }
      if (event.type === 'dictation-feedback') {
        receivedFeedback = true;
        const next = event.payload as DictationFeedback; setFeedback(next); setMessage('');
        if (next.phase !== 'listening') setLevel(0);
        if (next.phase === 'preparing' || next.phase === 'selecting') { receivedState = true; setState({ status: 'idle', session: null, error: '' }); }
      }
      if (event.type === 'dictation-readiness') setPreferences((event.payload as DictationReadiness).preferences);
      if (event.type === 'dictation-level') { lastLevel.current = Date.now(); setLevel(typeof event.payload === 'number' && Number.isFinite(event.payload) ? Math.max(0, Math.min(1, event.payload)) : 0); }
    });
    const timer = setInterval(() => { const time = Date.now(); setNow(time); if (time - lastLevel.current > 600) setLevel(0); }, 250);
    return () => { mounted = false; unsubscribe(); clearInterval(timer); document.body.classList.remove('overlay-body'); };
  }, []);
  const phase = feedback?.phase || (state.status === 'connecting' ? 'preparing' : state.status === 'recording' ? 'listening' : state.status === 'stopping' ? 'finishing' : 'done');
  const active = phase !== 'done';
  const result = state.session?.mode === 'dictation' ? state.session.dictation : undefined;
  const working = phase === 'preparing' || phase === 'finishing' || phase === 'polishing' || phase === 'inserting';
  const title = phase === 'selecting' ? '点进目标输入框' : phase === 'preparing' ? '正在准备…' : phase === 'listening' ? '正在聆听' : phase === 'finishing' ? '正在完成…' : phase === 'polishing' ? '正在整理…' : phase === 'inserting' ? '正在输入…' : result?.status === 'inserted' ? '已输入' : result?.status === 'sent' ? '请检查输入结果' : result?.status === 'retained' ? '文字已保留' : result?.status === 'cancelled' ? '已取消' : result?.status === 'empty' ? '未听到语音' : '听写结束';
  const fullText = (phase === 'preparing' || phase === 'selecting' ? '' : active ? words(state) : result?.text) || '';
  const tail = Array.from(fullText).slice(-90).join('');
  const hint = feedback?.mode === 'hold' ? `松开 ${holdName(preferences.holdKey, platform)} 输入` : `${shortcutName(preferences.handsFreeShortcut, platform)} 结束`;
  const detail = message || state.error || (phase === 'done' ? result?.message || feedback?.message : phase === 'listening' ? `${feedback?.targetName ? feedback.targetName + ' · ' : ''}${hint}` : feedback?.message) || '使用快捷键开始听写';
  return <div className={'dictation-hud phase-' + phase}>
    <div className="dictation-hud-heading"><span className="dictation-hud-status" role="status">{working ? <LoaderCircle size={17} className="spin" /> : result?.status === 'inserted' && !active ? <Check size={17} /> : <Mic size={17} />}{title}</span>
      {phase === 'listening' && <><div className="dictation-wave" aria-label="麦克风音量">{[.4, .65, .88, 1, .8, .6, .35].map((weight, index) => <i key={index} style={{ height: 3 + Math.min(19, Math.sqrt(level) * 52) * weight }} />)}</div><time>{duration(state.session ? now - state.session.startedAt : 0)}</time></>}
      <div className="dictation-hud-controls">{phase === 'selecting' && <button aria-label="填入目标输入框" onClick={() => window.speakbridge.insertArmedDictation().catch(error => setMessage(errorText(error)))}><ArrowRight size={15} />填入</button>}{(phase === 'listening' || phase === 'preparing') && <button className="dictation-stop" aria-label="结束听写" title="结束并输入" onClick={() => window.speakbridge.finishDictation().catch(error => setMessage(errorText(error)))}><Square size={11} fill="currentColor" /></button>}{phase !== 'inserting' && <button aria-label={active ? '取消听写' : '关闭听写窗口'} title={active ? '取消听写' : '关闭'} onClick={() => (active ? window.speakbridge.cancelDictation() : window.speakbridge.hideDictation()).catch(error => setMessage(errorText(error)))}><X size={17} /></button>}</div>
    </div>
    <div className={'dictation-hud-text ' + (!fullText ? 'empty' : '')} aria-label="听写文字" title={fullText}><LiveText text={tail || (phase === 'selecting' ? '选好输入框后，点右上角“填入”' : phase === 'preparing' ? '麦克风就绪后，开始说话' : phase === 'listening' ? '说吧，我在听…' : phase === 'finishing' ? '稍等一下，文字马上就好' : ' ')} settled={!active} /></div>
    <div className="dictation-hud-footer"><span role="status" title={detail}>{detail}</span>{!active && result?.retryable && <button onClick={() => window.speakbridge.armDictationInput('retry').catch(error => setMessage(errorText(error)))}>重新选择输入框</button>}{!active && result?.text && <button aria-label="复制" title="复制听写文字" onClick={() => window.speakbridge.copyDictation().then(() => setMessage('已复制')).catch(error => setMessage(errorText(error)))}><Copy size={13} />复制</button>}</div>
  </div>;
}
