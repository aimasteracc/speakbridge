const { EventEmitter } = require('node:events');
const { fork } = require('node:child_process');
const path = require('node:path');

// Native engines ship different ONNX Runtime DLL versions. Separate processes
// prevent DLL basename collisions on Windows and reclaim native model memory
// deterministically on model switches. No shell or transcript argv is used.
class InferenceProcess extends EventEmitter {
  constructor(entry, { workerData }) {
    super();
    this.child = fork(path.join(__dirname, 'inference-bootstrap.cjs'), [], {
      execPath: process.execPath, execArgv: [], serialization: 'advanced', windowsHide: true,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    });
    this.closed = false; this.stderr = '';
    this.child.stderr.on('data', chunk => { this.stderr = (this.stderr + chunk).slice(-2000); });
    this.child.on('message', message => this.emit('message', message));
    this.child.on('error', error => this.emit('error', error));
    this.child.on('exit', (code, signal) => { this.closed = true; this.emit('exit', code ?? (signal ? 1 : 0)); });
    this.child.send({ entry, workerData }, error => { if (error && !this.closed) this.emit('error', error); });
  }
  postMessage(message) {
    if (this.closed || !this.child.connected) throw new Error('本地识别进程已断开。');
    // Advanced serialization copies Float32Array/ArrayBuffer losslessly.
    this.child.send(message, error => { if (error && !this.closed) this.emit('error', error); });
  }
  terminate() {
    if (this.closed) return Promise.resolve();
    return new Promise(resolve => { this.child.once('exit', resolve); this.child.kill(); });
  }
}
module.exports = { InferenceProcess };
