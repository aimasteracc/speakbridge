import { createRoot } from 'react-dom/client';
import App from './App';
import { Overlay } from './Overlay';
import { DictationOverlay } from './Dictation';
import './styles.css';
createRoot(document.getElementById('root')!).render(window.speakbridge ? (location.hash === '#overlay' ? <Overlay /> : location.hash === '#dictation' ? <DictationOverlay /> : <App />) : <div className="browser-message"><h1>声桥 · SpeakBridge</h1><p>这是一款桌面应用。请使用桌面程序，或在项目目录运行 <code>npm run dev</code>。</p><p>麦克风、系统音频和置顶字幕由桌面端提供。</p></div>);
