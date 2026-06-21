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
      <h1>Linxicon</h1>
      {#if fatalError}
        <p class="fatal">{fatalError}</p>
      {:else}
        <p>Loading word model… {Math.round(progress)}%</p>
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
  :global(body) { margin: 0; background: #0b0e1f; }
  main { display: flex; flex-direction: column; height: 100vh; }
  .canvas { flex: 1; padding: 12px; }
  .loading { display: grid; place-items: center; height: 100vh; color: #eaeefb; font-family: system-ui, sans-serif; text-align: center; }
  h1 { color: #e8c547; }
  .fatal { color: #ff8a8a; max-width: 28rem; }
</style>
