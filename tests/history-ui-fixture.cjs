// Local UI fixture: production frontend + real Store/HistoryActions, disposable
// public text only. No microphone, native input, real history or provider APIs.
const http = require('node:http'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { Store } = require('../electron/store.cjs');
const { HistoryActions } = require('../electron/history.cjs');
const { notesPlan, notesLanguage } = require('../electron/meeting-notes.cjs');
const root = path.resolve(__dirname, '..'), dist = path.join(root, 'dist');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'speakbridge-history-ui-'));
const notesFixture = process.argv.includes('--notes');
const sampleNotes = notesFixture ? fs.readFileSync(path.join(__dirname, 'fixtures/meeting-notes.md'), 'utf8') : '';
const store = new Store(directory, {});
for (const [id, title] of [['alpha', '产品评审 · 测试记录'], ['beta', '周会 · 测试记录'], ['gamma', '日语练习 · 测试记录']]) {
  store.saveSession({ id, title, startedAt: Date.now(), endedAt: Date.now(), durationMs: 65000, status: 'completed', demo: false, starred: id === 'beta', notes: title + '的固定测试纪要。', audioSource: 'microphone', sourceLanguage: 'zh', targetLanguage: 'en', segments: [{ id: 'row-' + id, text: title + '的固定转写文本。', translation: 'Public test translation.', startMs: 0, endMs: 2000, final: true }] });
}
if (notesFixture) {
  store.saveSession({ ...store.find('alpha'), title: '議事録の表示テスト', notes: sampleNotes });
  store.saveSession({ ...store.find('beta'), title: '旧形式・再生成テスト', notes: '以前の議事録です。\n再生成に失敗しても、この内容を残します。' });
  store.saveSession({ ...store.find('gamma'), title: '新規生成テスト', notes: '' });
  store.settings = { ...store.settings, textProvider: 'api', translationModel: 'deepseek-flash', baseUrl: 'https://api.deepseek.com' };
}
const history = new HistoryActions(store);
let current = { id: 'dictation-test', mode: 'dictation', segments: [{ text: '这是一条待清除的固定听写结果。' }], dictation: { text: '这是一条待清除的固定听写结果。', status: 'retained', message: '固定测试结果', targetName: '测试编辑器' } };
const readiness = { preferences: { holdKey: 'off', handsFreeShortcut: 'CommandOrControl+Shift+D' }, holdAvailable: false, handsFreeAvailable: true, inputAvailable: true, microphonePermission: 'granted', modelInstalled: true, modelReady: true, message: '' };
const snapshot = () => ({ status: 'idle', session: current, error: '' });
const client = `const listeners=new Set();window.speakbridge={onEvent(fn){listeners.add(fn);return()=>listeners.delete(fn)}};
for(const method of ['bootstrap','dictationStatus','listSessions','deleteSession','deleteNotes','deleteSessions','deleteNotesMany','updateSession','clearDictation','makeNotes','notesStatus','notesPlan','cancelNotes'])window.speakbridge[method]=async(...args)=>{const response=await fetch('/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({method,args})});const result=await response.json();if(result.error)throw Error(result.error);for(const event of result.events||[])for(const fn of listeners)fn(event);return result.value;};`;
const server = http.createServer(async (req, res) => {
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:");
  try {
    if (req.url === '/rpc' && req.method === 'POST') {
      if (req.headers.origin && req.headers.origin !== `http://127.0.0.1:${server.address().port}`) throw Error('Invalid origin');
      let body = ''; for await (const chunk of req) { body += chunk; if (body.length > 10000) throw Error('Request too large'); }
      const { method, args } = JSON.parse(body); let value, changed = false;
      if (method === 'bootstrap') value = { settings: store.publicSettings(), sessions: store.sessions, state: snapshot(), platform: 'darwin', appVersion: require('../package.json').version + ' UI 测试', dictation: readiness, dataDirectory: '隔离测试目录', capabilities: {} };
      else if (method === 'dictationStatus') value = readiness;
      else if (method === 'listSessions') value = store.sessions;
      else if (method === 'deleteSession') { value = history.deleteSession(args[0]); changed = true; }
      else if (method === 'deleteNotes') { value = history.deleteNotes(args[0]); changed = true; }
      else if (method === 'deleteSessions') { value = history.deleteSessions(args[0]); changed = true; }
      else if (method === 'deleteNotesMany') { value = history.deleteNotesMany(args[0]); changed = true; }
      else if (method === 'notesStatus') value = history.notesStatus(args[0]);
      else if (method === 'notesPlan') value = notesPlan(store.find(args[0]), store.settings, 'api', args[1]);
      else if (method === 'cancelNotes') value = history.cancelNotes(args[0]);
      else if (method === 'makeNotes' && notesFixture) { value = await history.makeNotes(args[0], async () => { await new Promise(resolve => setTimeout(resolve, 1200)); if (args[0] === 'beta') throw Error('固定测试：生成失败，旧纪要保留'); return notesLanguage(store.find(args[0]), args[1]) === 'ja' ? sampleNotes : '# 中文会议纪要\n\n## 1. 会议概况\n\n| 项目 | 内容 |\n| --- | --- |\n| 时间 | 不明 |\n\n## 2. 议程\n\n- 固定测试\n\n## 3. 讨论内容\n\n公开测试资料。\n\n## 4. 决定事项\n\n资料中未明确提及。\n\n## 5. 行动项\n\n资料中未明确提及。\n\n## 6. 后续待讨论事项\n\n待确认。\n\n## 7. 会议总结\n\n公开测试资料。'; }, { settings: store.settings, provider: 'api', language: args[1] }); changed = true; }
      else if (method === 'updateSession') { value = { ...store.find(args[0]), ...args[1] }; store.saveSession(value); changed = true; }
      else if (method === 'clearDictation') { if (args[0] !== current?.id) throw Error('结果不存在'); current = null; value = true; }
      else throw Error('This fixture does not access devices or providers.');
      res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ value, events: [...(changed ? [{ type: 'history', payload: store.sessions }] : []), ...(method === 'clearDictation' ? [{ type: 'session', payload: snapshot() }] : [])] })); return;
    }
    if (req.url === '/fixture.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(client); return; }
    const relative = decodeURIComponent((req.url || '/').split('?')[0]);
    const file = relative === '/' ? path.join(dist, 'index.html') : path.resolve(dist, '.' + relative);
    if (!file.startsWith(dist + path.sep)) throw Error('Invalid path');
    let content = fs.readFileSync(file);
    if (file.endsWith('index.html')) content = content.toString().replace('<head>', '<head><script src="/fixture.js"></script>');
    res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html'); res.end(content);
  } catch (error) { res.statusCode = 400; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ error: error.message })); }
});
server.listen(0, '127.0.0.1', () => console.log(JSON.stringify({ url: `http://127.0.0.1:${server.address().port}`, fixtureDirectory: directory })));
process.on('SIGTERM', () => server.close(() => process.exit(0)));
