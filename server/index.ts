import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';
import { buildApp } from './app';
import { createService } from './embeddings';
import { VectorTable } from './vectorTable';
import { createMinilmLive } from './minilm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'data');
const DIST = join(ROOT, 'dist');
const PORT = Number(process.env.PORT ?? 8787);
const serveStatic = process.env.NODE_ENV === 'production' && existsSync(DIST);

const numberbatch = VectorTable.fromFiles(
  join(DATA, 'numberbatch.bin'),
  join(DATA, 'numberbatch-index.json'),
);
const minilm = VectorTable.fromFiles(
  join(DATA, 'minilm.bin'),
  join(DATA, 'minilm-index.json'),
);

const dictionary = new Set<string>(
  JSON.parse(readFileSync(join(ROOT, 'src/lib/words/dictionary.json'), 'utf8')) as string[],
);

const service = createService({ numberbatch, minilm, minilmLive: createMinilmLive(), dictionary });
const app = await buildApp({ service, staticDir: serveStatic ? DIST : undefined });

await app.listen({ port: PORT, host: '0.0.0.0' });
console.log(`embeddings API listening on :${PORT}${serveStatic ? ' (+ static dist/)' : ''}`);
