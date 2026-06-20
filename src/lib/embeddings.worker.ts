import { pipeline, env, type FeatureExtractionPipeline } from '@huggingface/transformers';

env.allowLocalModels = false; // fetch from the HF hub / CDN

let extractor: FeatureExtractionPipeline | null = null;

async function getExtractor(): Promise<FeatureExtractionPipeline> {
  if (!extractor) {
    extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
      progress_callback: (p: any) => {
        if (p?.status === 'progress') {
          self.postMessage({ type: 'progress', progress: p.progress ?? 0 });
        }
      },
    });
    self.postMessage({ type: 'ready' });
  }
  return extractor;
}

self.onmessage = async (ev: MessageEvent) => {
  const { id, word } = ev.data as { id: number; word: string };
  try {
    const ex = await getExtractor();
    const output = await ex(word, { pooling: 'mean', normalize: true });
    const vector = Float32Array.from(output.data as Float32Array);
    self.postMessage({ type: 'result', id, vector }, { transfer: [vector.buffer] });
  } catch (err) {
    self.postMessage({ type: 'error', id, message: String(err) });
  }
};

// Kick off model load eagerly so progress starts immediately.
getExtractor();
