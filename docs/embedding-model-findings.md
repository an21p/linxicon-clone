# Embedding model findings — choosing the similarity backend

_Investigation date: 2026-06-21. All numbers below were measured locally against the
actual models (not estimated)._

## TL;DR

- The game links two words when their embedding **cosine similarity > 0.41**. The
  quality of the game depends entirely on how well the chosen model separates
  *real associations* from *unrelated words* around that threshold.
- We benchmarked 6 models. **ConceptNet Numberbatch is the clear winner** — by a
  wide margin — for word-association play. **all-MiniLM-L6-v2** (the current
  in-browser model) is a reasonable second and the best of the sentence-transformers.
- Modern retrieval models (BGE / GTE / E5) are a **trap**: they top embedding
  leaderboards but, used on bare words, compress everything into a high-similarity
  band and rate genuinely unrelated words (e.g. `cow`~`nine`) at 60–80%. Unusable
  for this game.
- Recommendation: support **both** MiniLM and Numberbatch behind a dropdown so
  players can switch/compare; default to Numberbatch.

## Method

- Threshold under test: cosine > **0.41** (the game's link rule).
- Metric: **separation gap** = (lowest similarity among "related" pairs) − (highest
  similarity among "unrelated" pairs). A large positive gap means the 0.41 threshold
  sits in a clean valley and rarely misfires.
- Pair set (16 pairs): 10 intuitively "related" (cow~cattle, cow~milk, dog~cat,
  king~queen, hot~cold, car~vehicle, happy~joyful, ocean~sea, doctor~nurse,
  guitar~music) and 6 intuitively "unrelated" (cow~nine, table~democracy,
  pencil~ocean, banana~justice, cloud~tax, nine~cow).
- Vectors L2-normalized; cosine via dot product. Sentence models via
  `sentence-transformers`; Numberbatch via the 19.08 English 300-dim vectors.

## Results

Ranked by separation gap (higher = better for the game):

| Model | Related avg | Unrelated avg | **Separation gap** | cow~nine | Verdict |
|-------|:-----------:|:-------------:|:------------------:|:--------:|---------|
| **ConceptNet Numberbatch 19.08** | 68.9% | **2.2%** | **+42.9%** | **2.4%** | ✅ best |
| all-MiniLM-L6-v2 _(current)_ | 69.0% | 25.0% | +19.5% | 24.8% | ✅ good |
| all-mpnet-base-v2 | 63.6% | 18.5% | +15.1% | 11.5% | ✅ ok, heavier & slightly worse |
| BAAI/bge-small-en-v1.5 | 79.4% | 58.9% | +3.1% | 60.7% | ❌ no separation |
| thenlper/gte-small | 88.8% | 79.6% | +1.8% | 79.8% | ❌ no separation |
| intfloat/e5-small-v2 | 89.4% | 78.9% | +0.9% | 77.0% | ❌ no separation |

### Why retrieval models fail here
BGE / GTE / E5 are instruction/asymmetric-tuned for retrieval (they expect
`"query:"` / `"passage:"` prefixes). On bare single words their scores collapse
into a narrow high band — GTE rates the *unrelated* pairs at ~80% and calls
**cow~nine a 79.8% match**. No threshold can separate signal from noise.

### Why Numberbatch wins
It's built on a relatedness knowledge graph rather than pure distributional
co-occurrence, so unrelated pairs sit at ~2% (even negative: `pencil`~`ocean` =
−4.5%) while real associations stay 50–87%. It also rewards *relatedness*
(`cow`~`milk` 54.8%), not just *substitutability* (`cow`~`cattle` 76.5%) — which
makes for better puzzles. Note: Numberbatch is a **lookup table**, not an
inference model, so "in the browser" means shipping precomputed vectors, not
running a model.

## Case study: bridging `cow` → `nine`

These two words are genuinely far apart (MiniLM 24.8%, Numberbatch 2.4%). Human
intuition (e.g. the "nine lives" idiom, or counting cattle) does **not** match the
embedding space — wordplay leaps fail the 0.41 test. We BFS'd over a common-word
graph for valid chains:

- **MiniLM** reaches `nine` through **ages**:
  `cow → animals → humans → adults → eighteen → nine` (5 hops, weakest 51.5%).
- **Numberbatch** reaches `nine` through **quantity words** (a more human route):
  `cow → cattle → animals → humans → people → others → other → two → nine`
  (weakest 50.4%).
- The bottleneck-optimal MiniLM chain (every link ≥66%) is a 48-hop scenic tour:
  cattle → meat → body → clothing → ocean → military → competition → teens →
  numbers. Strong but unplayable — illustrates the short-vs-strong trade-off.

Key lesson: the only reliable doorway into the number cluster is via
**people → ages/quantities**, not counting or idioms. Embedding search beat human
guessing every time.

## Vocabulary coverage (implications for shipping Numberbatch in-browser)

- `src/lib/words/dictionary.json` currently holds **370,105** words (full English).
- Only **182,121** of those exist in Numberbatch; **187,984** are OOV — almost all
  obscure (`allagophyllous`, `eudalene`, `psychichthys`, …).
- A word is only playable if it has a vector. So the dictionary must be reconciled
  to words that have vectors.
- **Recommended curated vocab**: `wordfreq top_n_list("en", 40000)` ∩ Numberbatch ∩
  current dictionary. This drops obscure/OOV words, shrinks the shipped asset to
  ~12 MB (int8-quantized 300-dim) vs ~55 MB for the full 182k intersection, and
  makes better puzzles. Use the SAME curated vocab for both models so comparisons
  are fair.

## Recommended implementation

Add a **model-picker dropdown** (MiniLM ↔ Numberbatch) rather than replacing
MiniLM. Both already satisfy the `Embedder` interface (`embed(word) → Float32Array`)
and the engine is dimension-agnostic (cosine only).

Critical details:
1. **Shared curated vocabulary** for both models (fairness + Numberbatch's lookup
   constraint).
2. **Numberbatch as a static asset**: build `public/numberbatch.bin` (int8, N×300)
   + `public/numberbatch-index.json`; load + look up in a worker. No inference.
3. **Cache namespacing**: idb/in-mem key must become `vec:${modelId}:${word}` —
   otherwise 384-dim (MiniLM) and 300-dim (Numberbatch) vectors collide.
4. **Switching mid-game** must re-embed all current graph words with the new
   backend and recompute edges/gap (never mix vectors across models); re-run the
   same puzzle so the player can compare.
5. Default to Numberbatch; keep `@huggingface/transformers` for MiniLM.

## Reproduction

Assets used (local, one-time):
- Numberbatch: `https://conceptnet.s3.amazonaws.com/downloads/2019/numberbatch/numberbatch-en-19.08.txt.gz`
- Python env: `numpy`, `wordfreq`, `sentence-transformers` (for the sentence models).

Benchmark = encode each pair, cosine, compute the separation gap per model. Path
search = build a similarity matrix over the top-N common words, edge iff cosine >
0.41, BFS for shortest valid chain (and a max-bottleneck variant for the strongest).
