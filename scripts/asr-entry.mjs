import { pipeline, env } from '@huggingface/transformers';
export async function createRecognizer(cacheDir, allowDownload, progress) {
  env.cacheDir = cacheDir;
  env.allowLocalModels = true;
  env.localModelPath = cacheDir + '/';
  env.allowRemoteModels = allowDownload;
  // Local-only loading still reads the disk cache, never requests audio processing remotely.
  const recognizer = await pipeline('automatic-speech-recognition', 'onnx-community/whisper-base', {
    dtype: 'q8', device: 'cpu', local_files_only: !allowDownload,
    session_options: { intraOpNumThreads: 4, interOpNumThreads: 1 },
    progress_callback: progress,
  });
  env.allowRemoteModels = false;
  return async (audio, language) => {
    const output = await recognizer(audio, { task: 'transcribe', ...(language !== 'auto' ? { language } : {}), max_new_tokens: 192 });
    return output.text.trim();
  };
}
