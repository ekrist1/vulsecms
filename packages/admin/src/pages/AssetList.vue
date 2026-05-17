<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { RouterLink } from 'vue-router';
import { type AssetItem, api } from '../api/client.js';
import { useAuthStore } from '../stores/auth.js';
import { useToastsStore } from '../stores/toasts.js';

const auth = useAuthStore();
const toasts = useToastsStore();

const assets = ref<AssetItem[]>([]);
const total = ref(0);
const loading = ref(false);
const uploading = ref(false);
const s3Configured = ref<boolean | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);

async function load() {
  loading.value = true;
  try {
    const res = await api.listAssets({ limit: 200 });
    assets.value = res.items;
    total.value = res.total;
  } catch {
    toasts.error('Could not load assets');
  } finally {
    loading.value = false;
  }
}

async function checkS3() {
  try {
    const cfg = await api.getS3Settings();
    s3Configured.value = cfg.configured;
  } catch {
    s3Configured.value = false;
  }
}

function isImage(asset: AssetItem): boolean {
  if (asset.contentType?.startsWith('image/')) return true;
  return /\.(png|jpe?g|gif|webp|svg|avif)$/i.test(asset.url);
}

function humanSize(bytes: number | null): string {
  if (bytes == null) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function uploadFiles(files: FileList | null) {
  if (!files || files.length === 0) return;
  if (!s3Configured.value) {
    toasts.error('Configure S3 first in Settings → S3 Storage.');
    return;
  }
  uploading.value = true;
  try {
    for (const file of Array.from(files)) {
      try {
        const sign = await api.signAssetUpload({
          filename: file.name,
          contentType: file.type || 'application/octet-stream',
        });
        const res = await fetch(sign.uploadUrl, {
          method: 'PUT',
          headers: { ...sign.requiredHeaders },
          body: file,
        });
        if (!res.ok) throw new Error(`upload failed: ${res.status}`);
        await api.registerAsset({
          key: sign.key,
          bucket: sign.bucket,
          url: sign.publicUrl,
          contentType: file.type || null,
          size: file.size,
          originalName: file.name,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'upload failed';
        toasts.error(`${file.name}: ${message}`);
      }
    }
    toasts.success('Upload complete');
    await load();
  } finally {
    uploading.value = false;
  }
}

async function onPick(event: Event) {
  const target = event.target as HTMLInputElement;
  await uploadFiles(target.files);
  target.value = '';
}

async function destroy(a: AssetItem) {
  if (
    !confirm(
      `Delete asset ${a.originalName ?? a.key}? This removes the record but not the object in S3.`,
    )
  )
    return;
  try {
    await api.deleteAsset(a.id);
    toasts.success('Asset removed');
    await load();
  } catch {
    toasts.error('Could not delete asset');
  }
}

async function copyUrl(url: string) {
  try {
    await navigator.clipboard.writeText(url);
    toasts.success('URL copied');
  } catch {
    toasts.error('Copy failed');
  }
}

const canDelete = computed(() => !!auth.user?.isSuper);

onMounted(async () => {
  await checkS3();
  await load();
});
</script>

<template>
  <div class="p-6">
    <div class="mb-4 flex flex-wrap items-center justify-between gap-2">
      <h1 class="text-xl font-semibold">Assets</h1>
      <div class="flex items-center gap-2">
        <RouterLink
          v-if="auth.user?.isSuper"
          to="/settings/s3"
          class="rounded border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50"
        >
          S3 settings
        </RouterLink>
        <button
          type="button"
          class="rounded bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50"
          :disabled="uploading || s3Configured === false"
          data-testid="assets-upload-button"
          @click="fileInput?.click()"
        >
          {{ uploading ? 'Uploading…' : '+ Upload' }}
        </button>
        <input
          ref="fileInput"
          type="file"
          multiple
          class="hidden"
          data-testid="assets-file-input"
          @change="onPick"
        />
      </div>
    </div>

    <div
      v-if="s3Configured === false"
      class="mb-4 rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800"
    >
      <span v-if="auth.user?.isSuper">
        S3 is not configured.
        <RouterLink to="/settings/s3" class="underline">Set up storage</RouterLink>
        to start uploading assets.
      </span>
      <span v-else>
        Assets cannot be uploaded until an administrator configures S3 storage.
      </span>
    </div>

    <div v-if="loading" class="text-sm text-zinc-500">Loading…</div>
    <div v-else-if="assets.length === 0" class="text-sm text-zinc-500">
      No assets uploaded yet.
    </div>
    <div v-else class="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
      <div
        v-for="a in assets"
        :key="a.id"
        class="flex flex-col gap-1 rounded border border-zinc-200 p-2"
        :data-testid="`asset-card-${a.id}`"
      >
        <div class="flex h-32 w-full items-center justify-center overflow-hidden rounded bg-zinc-50">
          <img v-if="isImage(a)" :src="a.url" alt="" class="h-full w-full object-cover" />
          <span v-else class="px-1 text-center text-[10px] text-zinc-500 break-all">
            {{ a.originalName ?? a.key }}
          </span>
        </div>
        <div class="truncate text-xs font-medium text-zinc-800" :title="a.originalName ?? a.key">
          {{ a.originalName ?? a.key }}
        </div>
        <div class="text-[10px] text-zinc-500">
          {{ a.contentType ?? 'unknown' }}<span v-if="a.size"> · {{ humanSize(a.size) }}</span>
        </div>
        <div class="mt-1 flex items-center gap-2">
          <button
            type="button"
            class="text-[11px] text-zinc-600 hover:text-zinc-900"
            @click="copyUrl(a.url)"
          >
            Copy URL
          </button>
          <button
            v-if="canDelete"
            type="button"
            class="ml-auto text-[11px] text-red-600 hover:text-red-800"
            @click="destroy(a)"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
