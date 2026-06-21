<script lang="ts">
  import Graph from './components/Graph.svelte';
  import Hud from './components/Hud.svelte';
  import WinModal from './components/WinModal.svelte';
  import { createGame } from './lib/game';
  import { createEmbeddings } from './lib/embeddings';
  import { validateWord } from './lib/dictionary';
  import { generatePuzzle } from './lib/puzzles';

  const emb = createEmbeddings();
  const game = createGame({
    embedder: emb.embedder,
    validateWord,
    generatePuzzle: () => generatePuzzle(emb.embedder),
  });
  const { state, stats } = game;

  let progress = 0;
  let ready = false;
  let error: string | null = null;
  let fatalError: string | null = null;
  let busy = false;

  emb.onProgress((p) => (progress = p));
  emb.onReady(async () => {
    try { await game.newGame(); ready = true; }
    catch { fatalError = 'Could not start a game. Please reload.'; }
  });
  emb.onError((m) => (fatalError = m));

  async function onSubmit(e: CustomEvent<string>) {
    if (busy) return; // ignore re-submits while a word is being embedded
    error = null;
    busy = true;
    try {
      const res = await game.submitWord(e.detail);
      if (!res.ok) {
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
    error = null;
    busy = true;
    try { game.skip(); await game.newGame(); }
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
      best={$stats.best} {error} disabled={busy}
      on:submit={onSubmit} on:newgame={onNewGame} />
    <div class="canvas">
      <Graph
        nodes={$state.nodes} edges={$state.edges}
        targetA={$state.targetA} targetB={$state.targetB}
        lastWord={$state.lastWord} />
    </div>
    {#if $state.solved}
      <WinModal wordCount={$state.wordCount} best={$stats.best} on:again={onNewGame} />
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
  .canvas { flex: 1; min-height: 0; padding: 8px 16px 18px; }

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
