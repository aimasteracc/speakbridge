const path = require('node:path');
process.once('message', ({ entry, workerData }) => {
  const allowed = ['whisper-worker.cjs', 'vad-worker.cjs'].map(file => path.join(__dirname, file));
  if (!allowed.includes(entry)) return process.exit(1);
  require('./inference-port.cjs').workerData = workerData;
  require(entry);
});
// Do not leave a speech process running if the desktop parent exits/crashes.
process.on('disconnect', () => process.exit(0));
