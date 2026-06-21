import { buildIndex, lookup } from './numberbatch';

interface IndexFile { dim: number; words: string[]; }

let ready: Promise<{ index: Map<string, number>; matrix: Int8Array; dim: number }> | null = null;

function asset(name: string): string {
  // BASE_URL respects a non-root Vite base; assets live at the site root (public/).
  const base = (import.meta as any).env?.BASE_URL ?? '/';
  return base + name;
}

async function fetchBinWithProgress(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${url} -> ${res.status}`);
  const total = Number(res.headers.get('content-length') ?? 0);
  if (!res.body || !total) {
    const buf = await res.arrayBuffer();
    self.postMessage({ type: 'progress', progress: 100 });
    return buf;
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    self.postMessage({ type: 'progress', progress: (loaded / total) * 100 });
  }
  const out = new Uint8Array(loaded);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out.buffer;
}

function init() {
  if (!ready) {
    ready = (async () => {
      const index: IndexFile = await (await fetch(asset('numberbatch-index.json'))).json();
      const buf = await fetchBinWithProgress(asset('numberbatch.bin'));
      const matrix = new Int8Array(buf);
      const map = buildIndex(index.words);
      self.postMessage({ type: 'ready' });
      return { index: map, matrix, dim: index.dim };
    })();
  }
  return ready;
}

self.onmessage = async (ev: MessageEvent) => {
  const { id, word } = ev.data as { id: number; word: string };
  try {
    const { index, matrix, dim } = await init();
    const vec = lookup(index, matrix, dim, word);
    if (!vec) throw new Error(`no Numberbatch vector for "${word}"`);
    self.postMessage({ type: 'result', id, vector: vec }, { transfer: [vec.buffer] });
  } catch (err) {
    self.postMessage({ type: 'error', id, message: String(err) });
  }
};

// Kick off the download eagerly so progress starts immediately.
init();
