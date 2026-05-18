<script setup lang="ts">
import { RouterView } from 'vue-router';
</script>

<template>
  <div class="site-shell">
    <header class="site-header">
      <a class="site-brand" href="/">Vulse</a>
      <nav class="site-nav" aria-label="Primary">
        <a href="/posts">Posts</a>
        <a href="/admin">Admin</a>
      </nav>
    </header>
    <main class="site-main">
      <RouterView />
    </main>
  </div>
</template>
