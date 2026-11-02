import { useState, useSyncExternalStore, type CSSProperties } from 'react';
import { Check, Monitor, Palette, RotateCcw, FileText, AudioLines } from 'lucide-react';
import { getAppearance, palettes, setAppearance, subscribeAppearance, type Appearance } from './appearance';

export function AppearancePage() {
  const selected = useSyncExternalStore(subscribeAppearance, getAppearance);
  const [saveError, setSaveError] = useState(false);
  const choose = (value: Appearance) => setSaveError(!setAppearance(value));
  return <div className="appearance-page">
    <header className="page-header"><div><span className="eyebrow">YOUR SPACE, YOUR COLORS</span><h1>外观与配色</h1><p>选择一种舒服的配色，让每天的工作更自在。</p></div><button className="small-button" onClick={() => choose('system')}><RotateCcw size={15} aria-hidden="true" />恢复默认</button></header>
    <fieldset className="theme-options"><legend>工作空间主题</legend><p className="theme-help">点击即可应用，自动保存在这台设备上。</p><div className="theme-grid">
      {Object.entries(palettes).map(([id, palette]) => <label key={id} className="theme-option" style={{ '--preview-bg': palette.canvas, '--preview-surface': palette.surface, '--preview-text': palette.text, '--preview-muted': palette.muted, '--preview-accent': palette.accent, '--preview-soft': palette.soft } as CSSProperties}>
        <input type="radio" name="appearance" value={id} checked={selected === id} onChange={() => choose(id as Appearance)} />
        <span className="theme-sample" aria-hidden="true"><span className="sample-sidebar"><i /><i /><i /></span><span className="sample-content"><i /><i /><span /><b /></span></span>
        <span className="theme-option-title">{palette.name}<Check size={16} aria-hidden="true" /></span><span className="theme-description">{palette.detail}</span>
      </label>)}
      <label className="theme-option system-option"><input type="radio" name="appearance" value="system" checked={selected === 'system'} onChange={() => choose('system')} /><span className="system-sample" aria-hidden="true"><Monitor size={30} strokeWidth={1.6} /><span>LIGHT / DARK</span></span><span className="theme-option-title">跟随系统<Check size={16} aria-hidden="true" /></span><span className="theme-description">随系统切换雾白与深夜</span></label>
    </div></fieldset>
    <p className={'theme-saved' + (saveError ? ' theme-save-error' : '')} role="status">{saveError ? '配色已应用，但未能保存。请重新选择后重试。' : <><Check size={15} aria-hidden="true" />当前：{selected === 'system' ? '跟随系统' : palettes[selected].name} · 自动保存</>}</p>
    <section className="appearance-preview" aria-label="配色预览"><div className="preview-heading"><h2><Palette size={18} aria-hidden="true" />效果预览</h2><span>示例内容</span></div><div className="preview-columns">
      <div className="preview-transcript"><span className="preview-label"><AudioLines size={16} aria-hidden="true" />原文与翻译</span><p>把注意力留给对话。</p><p className="translated-text">会話に集中できる、心地よい空間。</p><div className="preview-action"><span>随时记录灵感</span><span className="preview-button">开始会话</span></div></div>
      <div className="preview-notes"><span className="preview-label"><FileText size={16} aria-hidden="true" />议事录</span><h3>下一步，清晰可见</h3><table><thead><tr><th>行动事项</th><th>状态</th></tr></thead><tbody><tr><td>确认会议讨论的重点</td><td><span className="preview-badge">未着手</span></td></tr></tbody></table></div>
    </div></section><p className="appearance-footnote">配色应用于主窗口、历史记录和议事录。悬浮字幕与听写提示保持深色，方便在其他应用上阅读。</p>
  </div>;
}
