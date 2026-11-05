import { useEffect, useState } from 'react';
import { Database, RefreshCw } from 'lucide-react';
import { DeleteButton } from './DeleteButton';
import type { DataStats } from './types';
const labels = { sessions: '会议与转写', media: '录屏与截图', clipboard: '剪贴板历史', questions: '屏幕问答', memories: '长期记忆', partial: '未完成的录制文件', ocr: 'OCR 语言模型缓存' };
export function DataManagement({ notify }: { notify: (message: string) => void }) {
  const [stats, setStats] = useState<DataStats>(), [busy, setBusy] = useState(false), [update, setUpdate] = useState('');
  async function refresh() { try { setStats(await window.speakbridge.dataStats()); } catch (e) { notify((e as Error).message); } }
  useEffect(() => { void refresh(); }, []);
  return <section className="settings-section"><h2><Database size={20} />数据管理</h2><p className="field-help">分别管理各类本地数据。删除会话时，独立素材历史里的视频仍会保留；删除视频不会删转写。未完成文件不代表可播放的视频。</p><button className="small-button" onClick={refresh}><RefreshCw size={15} />刷新用量</button>
    {stats && (Object.keys(labels) as (keyof typeof labels)[]).map(kind => <div className="data-row" key={kind}><div><strong>{labels[kind]}</strong><small>{stats[kind].count} 项 · {(stats[kind].bytes / 1024 ** 2).toFixed(1)} MB</small></div><DeleteButton label={'清空' + labels[kind]} description={`永久删除全部${labels[kind]}？其他类别的数据、服务设置和密钥会保留。`} disabled={!stats[kind].count || busy} onDelete={async () => { setBusy(true); try { setStats(await window.speakbridge.dataClear(kind)); notify(labels[kind] + '已清空'); } finally { setBusy(false); } }} /></div>)}
    <h3>应用更新</h3><p className="field-help">查询此项目的公开 GitHub Release，不发送本地记录。当前版本不自动安装更新；下载后的安装包仍需按系统要求确认。</p><button className="small-button" disabled={busy} onClick={async () => { setBusy(true); try { setUpdate(await window.speakbridge.checkUpdate()); } catch (e) { setUpdate((e as Error).message); } finally { setBusy(false); } }}>检查公开版本</button>{update && <p role="status" className="field-help">{update}</p>}
  </section>;
}
