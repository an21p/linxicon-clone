<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  export let targetA = '';
  export let targetB = '';
  export let wordCount = 0;
  export let gap = 0;
  export let best: number | null = null;
  export let error: string | null = null;
  export let disabled = false;

  let value = '';
  const dispatch = createEventDispatcher<{ submit: string; newgame: void }>();

  function submit() {
    const w = value.trim();
    if (!w) return;
    dispatch('submit', w);
    value = '';
  }
</script>

<div class="hud">
  <div class="targets">
    <span class="target">{targetA}</span>
    <span class="gap">gap {(gap * 100).toFixed(1)}%</span>
    <span class="target">{targetB}</span>
  </div>
  <form on:submit|preventDefault={submit}>
    <input bind:value placeholder="add a word…" {disabled} autocomplete="off" />
    <button type="submit" {disabled}>Add</button>
    <button type="button" on:click={() => dispatch('newgame')}>New game</button>
  </form>
  <div class="stats">
    <span>words used: {wordCount}</span>
    <span>best: {best ?? '—'}</span>
    {#if error}<span class="error">{error}</span>{/if}
  </div>
</div>

<style>
  .hud { display: flex; flex-direction: column; gap: 8px; padding: 12px; color: #eaeefb; font-family: system-ui, sans-serif; }
  .targets { display: flex; align-items: center; justify-content: center; gap: 16px; font-size: 22px; font-weight: 600; }
  .target { color: #e8c547; }
  .gap { font-size: 14px; color: #9fb0ff; }
  form { display: flex; gap: 8px; justify-content: center; }
  input { padding: 8px 12px; border-radius: 8px; border: 1px solid #3a4a7a; background: #1a2142; color: #eaeefb; }
  button { padding: 8px 14px; border-radius: 8px; border: none; background: #3a4a7a; color: #eaeefb; cursor: pointer; }
  .stats { display: flex; gap: 16px; justify-content: center; font-size: 13px; color: #9fb0ff; }
  .error { color: #ff8a8a; }
</style>
