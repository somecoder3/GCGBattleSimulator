<script lang="ts">
  import { onMount } from "svelte";
  import { onSync, renderSignIn, signOut, sync, type SyncState } from "../lib/sync";

  // Account menu at the right end of the top bar (cloud sync, src/app/lib/sync.ts): signed out a button that
  // opens Google's sign-in, signed in the name with sync status, "Abgleichen" and "Abmelden".

  let status = $state<SyncState>({ user: null, busy: false, lastSync: null, error: null, shared: [] });
  let open = $state(false);
  let root = $state<HTMLDivElement>();
  let google = $state<HTMLDivElement>();

  onMount(() =>
    onSync((s) => {
      // Signed in from the menu: close it.
      if (s.user && !status.user) open = false;
      status = s;
    }),
  );

  // Google's button is drawn anew each time the menu opens (the element is new).
  $effect(() => {
    if (open && !status.user && google) void renderSignIn(google);
  });

  // Close on a click outside or Escape.
  $effect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (root && !root.contains(e.target as Node)) open = false;
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") open = false;
    };
    addEventListener("pointerdown", away);
    addEventListener("keydown", key);
    return () => {
      removeEventListener("pointerdown", away);
      removeEventListener("keydown", key);
    };
  });

  const time = (d: Date) => d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  const initial = $derived(status.user?.name.trim().charAt(0).toUpperCase() ?? "");
  const mood = $derived(status.busy ? "busy" : status.error ? "error" : "ok");
</script>

<div class="account" bind:this={root}>
  <button
    class="trigger"
    class:signed={!!status.user}
    aria-haspopup="true"
    aria-expanded={open}
    onclick={() => (open = !open)}
  >
    {#if status.user}
      <span class="avatar" aria-hidden="true">{initial}<i class="dot {mood}"></i></span>
      <span class="name">{status.user.name}</span>
    {:else}
      <span class="cloud" aria-hidden="true">☁</span>
      <span class="name">Anmelden</span>
    {/if}
    <span class="caret" aria-hidden="true">▾</span>
  </button>

  {#if open}
    <div class="menu" role="menu">
      {#if status.user}
        <div class="who">
          <strong>{status.user.name}</strong>
          <small>{status.user.email}</small>
          <small class:err={!!status.error}>
            {#if status.busy}Gleicht ab …{:else if status.error}{status.error}{:else if status.lastSync}Abgeglichen
              um {time(status.lastSync)}{:else}Noch nicht abgeglichen{/if}
          </small>
        </div>
        <button role="menuitem" onclick={() => sync()} disabled={status.busy}>⟳ Jetzt abgleichen</button>
        <button
          role="menuitem"
          onclick={() => {
            open = false;
            void signOut();
          }}>Abmelden</button
        >
      {:else}
        <p>Mit Google anmelden: eigene Decks auf allen Geräten, Decks der anderen ansehen und kopieren.</p>
        <div class="google" bind:this={google}></div>
        {#if status.error}<p class="err">{status.error}</p>{/if}
      {/if}
    </div>
  {/if}
</div>

<style>
  .account {
    position: relative;
    margin-left: auto;
    flex: none;
  }
  .trigger {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 10px 4px 6px;
    border: 1px solid var(--line);
    border-radius: 999px;
    background: var(--bg-raised);
    font-size: 14px;
    white-space: nowrap;
  }
  .trigger:not(.signed) {
    padding-left: 10px;
  }
  .trigger:hover,
  .trigger[aria-expanded="true"] {
    border-color: color-mix(in srgb, var(--accent) 50%, var(--line));
  }
  .avatar {
    position: relative;
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    border-radius: 50%;
    background: linear-gradient(135deg, var(--accent) 0%, var(--c-purple) 100%);
    color: #fff;
    font-size: 12px;
    font-weight: 700;
  }
  .dot {
    position: absolute;
    right: -2px;
    bottom: -2px;
    width: 9px;
    height: 9px;
    border: 2px solid var(--bg-raised);
    border-radius: 50%;
    background: #3fbf6f;
  }
  .dot.busy {
    background: #f5c451;
  }
  .dot.error {
    background: var(--danger);
  }
  .cloud {
    color: var(--accent);
    font-size: 16px;
    line-height: 1;
  }
  .caret {
    color: var(--text-dim);
    font-size: 11px;
  }
  .menu {
    position: absolute;
    z-index: 30;
    right: 0;
    top: calc(100% + 8px);
    display: grid;
    gap: 4px;
    width: max-content;
    min-width: 240px;
    max-width: min(320px, calc(100vw - 32px));
    padding: 10px;
    border: 1px solid var(--line);
    border-radius: 12px;
    background: var(--bg-raised);
    box-shadow: var(--shadow);
    font-size: 14px;
  }
  .who {
    display: grid;
    gap: 2px;
    padding: 2px 6px 8px;
    border-bottom: 1px solid var(--line);
    margin-bottom: 4px;
  }
  .who small,
  p {
    color: var(--text-dim);
    font-size: 12px;
  }
  p {
    margin: 0 0 8px;
  }
  .menu button {
    padding: 7px 8px;
    border: 0;
    border-radius: 8px;
    background: none;
    text-align: left;
  }
  .menu button:hover:not(:disabled) {
    background: var(--bg-sunken);
  }
  .menu button:disabled {
    opacity: 0.5;
  }
  .google {
    min-height: 40px;
    color-scheme: light;
  }
  .err {
    color: var(--danger);
  }
  @media (max-width: 600px) {
    .name {
      max-width: 9em;
      overflow: hidden;
      text-overflow: ellipsis;
    }
  }
</style>
