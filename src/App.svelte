<script lang="ts">
  import Graph from './components/Graph.svelte';
  import VennBoard from './components/VennBoard.svelte';
  import LinksPanel from './components/LinksPanel.svelte';
  import Hud from './components/Hud.svelte';
  import WinModal from './components/WinModal.svelte';
  import { createGame } from './lib/game';
  import { createEmbeddings, type EmbeddingsHandle } from './lib/embeddings';
  import { validateWord } from './lib/dictionary';
  import { generatePuzzle } from './lib/puzzles';
  import { loadSeed, advanceSeed, seededRng, PUZZLE_PARAM, type Seed } from './lib/seed';
  import { DEFAULT_MODEL, isModelId, MODELS, type ModelId } from './lib/models';
  import { puzzleKey, loadWords, saveWords } from './lib/savedGames';

  const STORAGE_KEY = 'linxicon.model';
  const VIEW_PARAM = 'view';

  function loadModel(): ModelId {
    const saved = localStorage.getItem(STORAGE_KEY);
    return isModelId(saved) ? saved : DEFAULT_MODEL;
  }

  type View = 'graph' | 'venn';
  function loadView(): View {
    return new URLSearchParams(location.search).get(VIEW_PARAM) === 'venn' ? 'venn' : 'graph';
  }
  let view: View = loadView();

  function setView(next: View) {
    if (next === view) return;
    view = next;
    const url = new URL(location.href);
    url.searchParams.set(VIEW_PARAM, next);
    history.replaceState(history.state, '', url);
  }

  // Per-model connect/win threshold, adjustable at runtime for testing and
  // persisted so a tuned value survives reloads. Defaults to each model's value.
  const THRESH_KEY = 'linxicon.thresholds';
  function loadThresholds(): Record<ModelId, number> {
    const base = { minilm: MODELS.minilm.threshold, numberbatch: MODELS.numberbatch.threshold };
    try {
      const saved = JSON.parse(localStorage.getItem(THRESH_KEY) ?? '{}');
      if (typeof saved.minilm === 'number') base.minilm = saved.minilm;
      if (typeof saved.numberbatch === 'number') base.numberbatch = saved.numberbatch;
    } catch { /* ignore malformed */ }
    return base;
  }
  let thresholds: Record<ModelId, number> = loadThresholds();

  let model: ModelId = loadModel();
  $: threshold = thresholds[model];
  let emb: EmbeddingsHandle = createEmbeddings(model);

  // Deterministic daily puzzle: reload keeps the same words; "new chart" advances the count.
  // The puzzle number (count) is sourced from / reflected in the ?puzzle=N query param.
  let seed: Seed = loadSeed(localStorage, Date.now(), location.search);
  syncPuzzleUrl(seed.count);

  // Persist/restore the words placed in each puzzle, keyed by day+count.
  $: currentKey = puzzleKey(seed.day, seed.count);
  function persistWords() {
    saveWords(localStorage, currentKey, game.getWords());
  }

  // Reflect the current puzzle number in the address bar without adding history entries.
  function syncPuzzleUrl(count: number) {
    const url = new URL(location.href);
    url.searchParams.set(PUZZLE_PARAM, String(count));
    history.replaceState(history.state, '', url);
  }

  const game = createGame({
    embedder: emb.embedder,
    validateWord,
    generatePuzzle: () => generatePuzzle({ rng: seededRng(seed.day, seed.count) }),
    threshold: thresholds[model],
  });
  const { state, stats } = game;

  let progress = 0;
  let ready = false;
  let error: string | null = null;
  let fatalError: string | null = null;
  let busy = false;

  // --- result reveal: walk the bridge path A→B, lighting one word at a time ---
  const REVEAL_STEP_MS = 700;
  let revealPath: string[] = [];
  let revealStep = -1; // -1 = inactive; otherwise index of the word being lit
  let revealTimer: ReturnType<typeof setTimeout> | null = null;

  function stopReveal() {
    if (revealTimer) { clearTimeout(revealTimer); revealTimer = null; }
    revealStep = -1;
    revealPath = [];
  }

  function startReveal() {
    stopReveal();
    const path = game.bridgePath();
    if (path.length < 2) return;
    revealPath = path;
    revealStep = 0;
    const tick = () => {
      if (revealStep >= revealPath.length - 1) {
        revealTimer = setTimeout(stopReveal, 1800); // hold the full bridge, then clear
        return;
      }
      revealStep += 1;
      revealTimer = setTimeout(tick, REVEAL_STEP_MS);
    };
    revealTimer = setTimeout(tick, REVEAL_STEP_MS);
  }

  // On a win, trace the bridge automatically first; the modal waits until it ends.
  let revealedForWin = false;
  $: if ($state.solved && !revealedForWin) { revealedForWin = true; startReveal(); }
  $: if (!$state.solved) revealedForWin = false;

  // suppress the win modal while the bridge is being traced
  $: showWin = $state.solved && revealStep < 0;

  function bindEmbeddings(handle: EmbeddingsHandle, onReady: () => void | Promise<void>) {
    progress = 0;
    handle.onProgress((p) => (progress = p));
    handle.onReady(() => { void onReady(); });
    handle.onError((m) => (fatalError = m));
  }

  async function restoreSaved() {
    await game.restoreWords(loadWords(localStorage, puzzleKey(seed.day, seed.count)));
  }

  bindEmbeddings(emb, async () => {
    try { await game.newGame(); await restoreSaved(); ready = true; }
    catch { fatalError = 'Could not start a game. Please reload.'; }
  });

  async function onModelChange(e: CustomEvent<ModelId>) {
    const next = e.detail;
    if (next === model || busy) return;
    stopReveal();
    model = next;
    localStorage.setItem(STORAGE_KEY, next);
    error = null;
    fatalError = null;
    busy = true;
    ready = false;            // show the orrery/progress while the new model inits
    emb.destroy();
    emb = createEmbeddings(next);
    game.setEmbedder(emb.embedder);
    game.setThreshold(thresholds[next]);
    bindEmbeddings(emb, async () => {
      try {
        await game.reEmbedCurrent();   // same puzzle, re-scored under the new backend
        ready = true;
      } catch {
        fatalError = 'Could not switch model. Please reload.';
      } finally {
        busy = false;
      }
    });
  }

  function onThresholdChange(e: CustomEvent<number>) {
    if (busy) return;
    stopReveal();
    thresholds = { ...thresholds, [model]: e.detail };
    localStorage.setItem(THRESH_KEY, JSON.stringify(thresholds));
    game.setThreshold(e.detail);
    game.rescore(); // re-link the current board live, no re-embedding
  }

  async function onHint() {
    if (busy) return;
    stopReveal();
    error = null;
    busy = true;
    try {
      const bl = game.bottleneckLink();
      if (!bl) { error = 'add a word first'; return; }
      const exclude = [$state.targetA, $state.targetB, ...game.getWords()];
      const word = await emb.hint(bl.a, bl.b, exclude);
      if (!word) { error = 'no hint available'; return; }
      const res = await game.submitWord(word);
      if (res.ok) persistWords();
      else error = 'that hint was already on the board';
    } catch {
      error = 'could not fetch a hint';
    } finally {
      busy = false;
    }
  }

  async function onSubmit(e: CustomEvent<string>) {
    if (busy) return; // ignore re-submits while a word is being embedded
    stopReveal();
    error = null;
    busy = true;
    try {
      const res = await game.submitWord(e.detail);
      if (res.ok) {
        persistWords();
      } else {
        error = res.reason === 'duplicate' ? 'already on the board'
          : res.reason === 'unknown' ? 'not a recognized word'
          : 'enter a single word';
      }
    } catch {
      error = 'something went wrong adding that word';
    } finally {
      busy = false;
    }
  }

  async function onNewGame() {
    stopReveal();
    error = null;
    busy = true;
    try { game.skip(); seed = advanceSeed(); syncPuzzleUrl(seed.count); await game.newGame(); await restoreSaved(); }
    catch { error = 'could not start a new game'; }
    finally { busy = false; }
  }
</script>

<main>
  {#if !ready}
    <div class="loading">
      <div class="orrery" class:dead={!!fatalError}>
        <span class="sun"></span>
        <span class="ring r1"><span class="planet"></span></span>
        <span class="ring r2"><span class="planet"></span></span>
        <span class="ring r3"><span class="planet"></span></span>
      </div>
      <h1>Linxicon</h1>
      <p class="tagline">an atlas of meaning</p>
      {#if fatalError}
        <p class="fatal">{fatalError}</p>
      {:else}
        <div class="progress">
          <div class="meter"><div class="lit" style={`width:${Math.round(progress)}%`}></div></div>
          <p class="pct">charting the heavens · {Math.round(progress)}%</p>
        </div>
      {/if}
    </div>
  {:else}
    <Hud
      targetA={$state.targetA} targetB={$state.targetB}
      wordCount={$state.wordCount} gap={$state.gap}
      best={$stats.best} {error} disabled={busy} {model} {threshold} {view}
      on:submit={onSubmit} on:newgame={onNewGame} on:model={onModelChange}
      on:view={(e) => setView(e.detail)} on:threshold={onThresholdChange} on:hint={onHint} />
    <div class="canvas">
      <LinksPanel edges={$state.edges} targetA={$state.targetA} targetB={$state.targetB} />
      <div class="board">
        {#key model}
          {#if view === 'venn'}
            <VennBoard
              nodes={$state.nodes} edges={$state.edges}
              targetA={$state.targetA} targetB={$state.targetB}
              lastWord={$state.lastWord} {threshold}
              {revealPath} {revealStep} />
          {:else}
            <Graph
              nodes={$state.nodes} edges={$state.edges}
              targetA={$state.targetA} targetB={$state.targetB}
              lastWord={$state.lastWord}
              {revealPath} {revealStep} />
          {/if}
        {/key}
      </div>
    </div>
    {#if showWin}
      <WinModal wordCount={$state.wordCount} best={$stats.best}
        on:again={onNewGame} on:trace={startReveal} />
    {/if}
  {/if}
</main>

<style>
  main {
    display: flex;
    flex-direction: column;
    height: 100%;
    max-width: 1180px;
    margin: 0 auto;
  }
  .canvas {
    flex: 1;
    min-height: 0;
    padding: 8px 16px 18px;
    display: grid;
    grid-template-columns: minmax(200px, 240px) 1fr;
    gap: 14px;
  }
  .board { min-width: 0; min-height: 0; }

  @media (max-width: 760px) {
    .canvas {
      grid-template-columns: 1fr;
      grid-template-rows: 1fr auto;
    }
    .board { order: -1; min-height: 320px; }
  }

  .loading {
    display: grid;
    place-items: center;
    align-content: center;
    gap: 10px;
    height: 100%;
    text-align: center;
    animation: fade 0.8s ease;
  }
  h1 {
    font-family: var(--display);
    font-weight: 400;
    font-size: clamp(48px, 11vw, 86px);
    margin: 14px 0 0;
    color: var(--star);
    letter-spacing: 0.01em;
    text-shadow: 0 0 40px rgba(146, 160, 207, 0.35);
  }
  .tagline {
    font-family: var(--mono);
    text-transform: uppercase;
    letter-spacing: 0.42em;
    font-size: 11px;
    color: var(--gold);
    margin: 0 0 6px;
    padding-left: 0.42em;
  }

  /* a small orrery turns while the model loads */
  .orrery {
    position: relative;
    width: 120px;
    height: 120px;
    display: grid;
    place-items: center;
  }
  .sun {
    width: 14px; height: 14px; border-radius: 50%;
    background: radial-gradient(circle, var(--gold-bright), var(--gold));
    box-shadow: 0 0 26px 6px rgba(240, 198, 116, 0.6);
  }
  .ring {
    position: absolute;
    border: 1px solid var(--panel-line);
    border-radius: 50%;
    inset: 0;
    margin: auto;
    animation: spin linear infinite;
  }
  .r1 { width: 52px; height: 52px; animation-duration: 4s; }
  .r2 { width: 84px; height: 84px; animation-duration: 7s; }
  .r3 { width: 118px; height: 118px; animation-duration: 11s; }
  .planet {
    position: absolute;
    top: -3px; left: 50%;
    width: 6px; height: 6px; border-radius: 50%;
    background: var(--star);
    box-shadow: 0 0 10px 1px rgba(159, 176, 255, 0.8);
  }
  .r2 .planet { background: var(--cyan); box-shadow: 0 0 10px 1px rgba(116, 227, 218, 0.8); }
  .r3 .planet { background: var(--gold); box-shadow: 0 0 10px 1px rgba(240, 198, 116, 0.8); }
  .orrery.dead { animation: none; opacity: 0.4; filter: grayscale(0.6); }
  .orrery.dead .ring { animation: none; }

  .progress { display: grid; gap: 10px; place-items: center; margin-top: 6px; }
  .meter {
    width: 220px; height: 2px;
    background: var(--panel-line);
    overflow: hidden;
  }
  .lit {
    height: 100%;
    background: linear-gradient(90deg, var(--gold), var(--cyan));
    box-shadow: 0 0 12px rgba(116, 227, 218, 0.7);
    transition: width 0.4s ease;
  }
  .pct {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.18em;
    color: var(--muted);
  }
  .fatal {
    color: var(--danger);
    max-width: 28rem;
    font-size: 14px;
    line-height: 1.5;
    margin-top: 8px;
  }

  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes fade { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
</style>
