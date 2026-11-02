module.exports = {
  workerData: null,
  parentPort: {
    postMessage(message) { if (process.connected) process.send(message); },
    on(event, listener) { process.on(event, listener); },
  },
};
