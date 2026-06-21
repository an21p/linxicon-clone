<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  export let wordCount = 0;
  export let best: number | null = null;
  const dispatch = createEventDispatcher<{ again: void }>();
</script>

<div class="backdrop">
  <div class="modal">
    <h2>Connected! 🎉</h2>
    <p>You bridged them with <strong>{wordCount}</strong> word{wordCount === 1 ? '' : 's'}.</p>
    <p class="best">Best: {best ?? wordCount}</p>
    <button on:click={() => dispatch('again')}>Play again</button>
  </div>
</div>

<style>
  .backdrop { position: fixed; inset: 0; background: rgba(10, 12, 28, 0.7); display: grid; place-items: center; }
  .modal { background: #1a2142; color: #eaeefb; padding: 28px 36px; border-radius: 16px; text-align: center; font-family: system-ui, sans-serif; }
  button { margin-top: 12px; padding: 10px 18px; border: none; border-radius: 8px; background: #e8c547; color: #1a1a2e; font-weight: 600; cursor: pointer; }
  .best { color: #9fb0ff; }
</style>
