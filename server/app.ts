import Fastify, { type FastifyInstance } from 'fastify';
import type { EmbeddingsService } from './embeddings';
import { isModelId, MODELS } from '../src/lib/models';

export interface AppDeps {
  service: EmbeddingsService;
  staticDir?: string; // when set, serve the built site (production single-origin)
}

interface EmbedBody {
  model?: unknown;
  words?: unknown;
}

// Bounds keep the public (tunnel-exposed) API cheap to serve: a long word would
// otherwise stall the single-threaded MiniLM live-inference fallback.
const MAX_WORDS = 256;
const MAX_WORD_LEN = 200;

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, handlerTimeout: 30_000, bodyLimit: 256 * 1024 });

  app.get('/api/health', async () => ({ ok: true, models: Object.keys(MODELS) }));

  app.post('/api/embed', async (req, reply) => {
    const { model, words } = (req.body ?? {}) as EmbedBody;
    if (!isModelId(model)) return reply.code(400).send({ error: 'unknown model' });
    if (
      !Array.isArray(words) || words.length === 0 || words.length > MAX_WORDS ||
      !words.every((w) => typeof w === 'string' && w.length <= MAX_WORD_LEN)
    ) {
      return reply
        .code(400)
        .send({ error: `words must be a non-empty string[] (max ${MAX_WORDS}, each ≤ ${MAX_WORD_LEN} chars)` });
    }
    const vectors = await deps.service.embed(model, words as string[]);
    return { model, dim: deps.service.dim(model), vectors };
  });

  if (deps.staticDir) {
    const { default: fastifyStatic } = await import('@fastify/static');
    await app.register(fastifyStatic, { root: deps.staticDir });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'not found' });
      return reply.sendFile('index.html');
    });
  }

  return app;
}
