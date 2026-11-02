import { useEffect, useState } from 'react';
import { AudioLines, X, GripHorizontal } from 'lucide-react';
import type { SessionState } from './types';
import { LiveText } from './LiveText';
import { hasSpeechText } from './text-motion';
import { useFollowScroll } from './useFollowScroll';
export function Overlay() {
  const [state, setState] = useState<SessionState>({ status: 'idle', session: null, error: '' });
  const [size, setSize] = useState(24);
  const scroll = useFollowScroll(true, state.session?.id);
  useEffect(() => {
    document.body.classList.add('overlay-body');
    window.speakbridge.bootstrap().then(data => { setState(data.state); setSize(data.settings.subtitleFontSize); });
    return window.speakbridge.onEvent(event => { if (event.type === 'session') setState(event.payload as SessionState); });
  }, []);
  const row = state.session?.segments.filter(segment => hasSpeechText(segment.text)).at(-1);
  return <div className="subtitle-window">
    <div className="subtitle-toolbar"><span><AudioLines size={15} /> 声桥字幕 {state.session?.demo ? '· 演示' : ''}</span><GripHorizontal size={18} /><button aria-label="关闭字幕" onClick={() => window.speakbridge.hideOverlay()}><X size={17} /></button></div>
    <div className="subtitle-copy" data-follow={scroll.paused ? 'paused' : 'active'} ref={scroll.viewport} onScroll={scroll.onScroll} onWheel={scroll.onWheel} onKeyDown={scroll.onKeyDown} onPointerDown={scroll.onPointerDown} tabIndex={0} aria-label="实时字幕" style={{ fontSize: size }}><div ref={scroll.content}>
      {row ? <div key={row.id}><div className="subtitle-original"><LiveText text={row.text} settled={row.final || state.status !== 'recording'} /><span className={'live-caret ' + (!row.final ? 'active' : '')} aria-hidden="true" /></div>{row.translation && <div className="subtitle-translation"><LiveText text={row.translation} /></div>}</div> : <div className="subtitle-wait">{state.status === 'recording' ? '正在聆听，字幕会显示在这里…' : '开始会话后，字幕会显示在这里'}</div>}
    </div></div>
    {scroll.paused && <button className="subtitle-follow" onClick={scroll.resume}>↓ 最新字幕</button>}
    {state.error && <div className="subtitle-error">{state.error}</div>}
  </div>;
}
