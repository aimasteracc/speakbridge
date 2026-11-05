const { createWorker } = require('tesseract.js');
process.parentPort.on('message', async ({ data }) => {
  let worker;
  try {
    worker = await createWorker(data.language === 'eng' ? 'eng' : [data.language, 'eng'], 1, {
      cachePath: data.cachePath, langPath: 'https://tessdata.projectnaptha.com/4.0.0',
      logger: value => process.parentPort.postMessage({ type: 'progress', status: value.status }), errorHandler: () => {},
    });
    const { data: result } = await worker.recognize(data.file);
    process.parentPort.postMessage({ type: 'result', text: result.text });
  } catch { process.parentPort.postMessage({ type: 'error' }); }
  finally { if (worker) await worker.terminate(); }
});
