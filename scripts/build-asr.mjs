import { rolldown } from 'rolldown';
// Audio inference never uses Sharp; omit its image-only native dependency so
// the same artifact can run on macOS and Windows with ONNX Runtime alone.
const build = await rolldown({ input: 'scripts/asr-entry.mjs', platform: 'node', external: ['onnxruntime-node'], plugins: [{
  name: 'audio-only',
  resolveId(id) { if (id === 'sharp') return '\0audio-only-sharp'; },
  load(id) { if (id === '\0audio-only-sharp') return 'export default function() { throw new Error("Image processing is not included in this audio-only runtime"); }'; },
}] });
await build.write({ file: 'electron/asr-runtime.mjs', format: 'esm', minify: true });
await build.close();
console.log('Built audio-only local Whisper runtime');
