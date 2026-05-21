<template>
  <div class="marketing-shell">
    <header class="marketing-header">
      <a class="marketing-brand" href="/">Vulse Dev</a>
      <nav aria-label="Site navigation">
        <a href="/posts">Posts</a>
        <a href="/admin">Admin</a>
      </nav>
    </header>
    <main class="marketing-main">
      <slot />
    </main>
  </div>
</template>

<style scoped>
.marketing-shell {
  min-height: 100vh;
  background:
    radial-gradient(circle at top left, rgb(255 255 255 / 0.82), transparent 34rem),
    linear-gradient(135deg, #f5efe4 0%, #d7e3d0 50%, #f1d2bd 100%);
  color: #1f2720;
}

.marketing-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  max-width: 72rem;
  margin: 0 auto;
  padding: 1.5rem clamp(1rem, 3vw, 2rem);
}

.marketing-brand {
  color: inherit;
  font-weight: 800;
  letter-spacing: -0.04em;
  text-decoration: none;
}

nav {
  display: flex;
  gap: 1rem;
}

nav a {
  color: inherit;
  font-weight: 700;
  text-decoration: none;
}

.marketing-main {
  max-width: 72rem;
  margin: 0 auto;
  padding: clamp(2rem, 6vw, 5rem) clamp(1rem, 3vw, 2rem);
}
</style>
