const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'speakbridge-icon-'));
app.setPath('userData', temporary);
app.whenReady().then(async () => {
  const window = new BrowserWindow({ width: 1024, height: 1024, show: false, frame: false, transparent: true, webPreferences: { nodeIntegration: false, contextIsolation: true, offscreen: true } });
  const svg = fs.readFileSync(path.join(__dirname, '../build/icon.svg'), 'utf8');
  const painted = new Promise(resolve => window.webContents.once('paint', (_event, _rect, image) => resolve(image)));
  await window.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent('<body style="margin:0;background:transparent">' + svg + '</body>'));
  const picture = await painted;
  fs.writeFileSync(path.join(__dirname, '../build/icon.png'), picture.resize({ width: 1024, height: 1024 }).toPNG());
  console.log('Created build/icon.png');
  window.destroy(); app.quit();
}).catch(error => { console.error(error); app.exit(1); });
app.on('quit', () => fs.rmSync(temporary, { recursive: true, force: true }));
