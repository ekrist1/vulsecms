<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { type AssetItem, api } from '../../api/client.js';
import { useToastsStore } from '../../stores/toasts.js';

const props = defineProps<{
  name: string;
  modelValue: string | undefined;
  error?: string;
}>();
const emit = defineEmits<{ 'update:modelValue': [string | undefined] }>();

const toasts = useToastsStore();
const pickerOpen = ref(false);
const assets = ref<AssetItem[]>([]);
const thumbUrls = reactive<Record<string, string>>({});

async function ensureThumb(id: string): Promise<void> {
  if (thumbUrls[id]) return;
  try {
    const { url } = await api.getAssetThumbUrl(id, 240);
    thumbUrls[id] = url;
  } catch {
    /* fall back to raw url */
  }
}
const loading = ref(false);
const uploading = ref(false);
const fileInput = ref<HTMLInputElement | null>(null);

const selectedAsset = computed<AssetItem | null>(() => {
  if (!props.modelValue) return null;
  return assets.value.find((a) => a.url === props.modelValue || a.id === props.modelValue) ?? null;
});

async function loadAssets() {
  loading.value = true;
  try {
    const res = await api.listAssets({ limit: 100 });
    assets.value = res.items;
    for (const a of res.items) {
      if (isImage(a)) ensureThumb(a.id);
    }
  } catch (e) {
    toasts.error('Could not load assets');
  } finally {
    loading.value = false;
  }
}

function openPicker() {
  pickerOpen.value = true;
  if (assets.value.length === 0) loadAssets();
}

function selectAsset(asset: AssetItem) {
  emit('update:modelValue', asset.url);
  pickerOpen.value = false;
}

function clear() {
  emit('update:modelValue', undefined);
}

async function onUpload(event: Event) {
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0];
  if (!file) return;
  uploading.value = true;
  try {
    const sign = await api.signAssetUpload({
      filename: file.name,
      contentType: file.type || 'application/octet-stream',
    });
    const putHeaders: Record<string, string> = { ...sign.requiredHeaders };
    const res = await fetch(sign.uploadUrl, {
      method: 'PUT',
      headers: putHeaders,
      body: file,
    });
    if (!res.ok) {
      throw new Error(`upload failed: ${res.status}`);
    }
    const asset = await api.registerAsset({
      key: sign.key,
      bucket: sign.bucket,
      url: sign.publicUrl,
      contentType: file.type || null,
      size: file.size,
      originalName: file.name,
    });
    assets.value = [asset, ...assets.value];
    if (isImage(asset)) ensureThumb(asset.id);
    emit('update:modelValue', asset.url);
    toasts.success('Asset uploaded');
    pickerOpen.value = false;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'upload failed';
    if (message.includes('s3_not_configured') || message.includes('412')) {
      toasts.error('S3 is not configured yet. Set it up in Settings → S3 Storage.');
    } else {
      toasts.error(message);
    }
  } finally {
    uploading.value = false;
    target.value = '';
  }
}

onMounted(() => {
  if (props.modelValue) loadAssets();
});

function isImage(asset: AssetItem | null): boolean {
  if (!asset) return false;
  if (asset.contentType?.startsWith('image/')) return true;
  return /\.(png|jpe?g|gif|webp|svg|avif)$/i.test(asset.url);
}

function fileNameFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const seg = u.pathname.split('/').filter(Boolean).pop() ?? url;
    return decodeURIComponent(seg);
  } catch {
    return url;
  }
}
</script>

<template>
  <div>
    <span class="block text-sm font-medium text-zinc-700 capitalize">{{ name }}</span>
    <div class="mt-1 flex items-start gap-3 rounded border border-zinc-300 p-2">
      <div
        v-if="modelValue"
        class="flex h-20 w-20 items-center justify-center overflow-hidden rounded border border-zinc-200 bg-zinc-50"
      >
        <img
          v-if="isImage(selectedAsset) || /\.(png|jpe?g|gif|webp|svg|avif)$/i.test(modelValue)"
          :src="thumbUrls[selectedAsset?.id ?? ''] ?? modelValue"
          alt=""
          class="h-full w-full object-cover"
        />
        <span v-else class="px-1 text-center text-[10px] text-zinc-500 break-all">
          {{ fileNameFromUrl(modelValue) }}
        </span>
      </div>
      <div class="min-w-0 flex-1">
        <div v-if="modelValue" class="truncate font-mono text-xs text-zinc-700" :title="modelValue">
          {{ modelValue }}
        </div>
        <div v-else class="text-xs text-zinc-400">No asset selected</div>
        <div class="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            class="rounded border border-zinc-300 bg-white px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
            :data-testid="`asset-pick-${name}`"
            @click="openPicker"
          >
            {{ modelValue ? 'Change' : 'Choose asset' }}
          </button>
          <button
            v-if="modelValue"
            type="button"
            class="rounded border border-zinc-300 bg-white px-2.5 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-50"
            @click="clear"
          >
            Clear
          </button>
        </div>
      </div>
    </div>
    <span v-if="error" class="mt-1 block text-xs text-red-600">{{ error }}</span>

    <div
      v-if="pickerOpen"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      @click.self="pickerOpen = false"
    >
      <div class="flex max-h-[80vh] w-[min(900px,92vw)] flex-col rounded-lg bg-white shadow-xl">
        <div class="flex items-center justify-between border-b border-zinc-200 px-4 py-3">
          <h2 class="text-sm font-semibold">Choose an asset</h2>
          <div class="flex items-center gap-2">
            <button
              type="button"
              class="rounded bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-700 disabled:opacity-50"
              :disabled="uploading"
              @click="fileInput?.click()"
            >
              {{ uploading ? 'Uploading…' : 'Upload new' }}
            </button>
            <input
              ref="fileInput"
              type="file"
              class="hidden"
              :data-testid="`asset-upload-${name}`"
              @change="onUpload"
            />
            <button
              type="button"
              class="rounded border border-zinc-300 bg-white px-3 py-1.5 text-xs text-zinc-700 hover:bg-zinc-50"
              @click="pickerOpen = false"
            >
              Close
            </button>
          </div>
        </div>
        <div class="overflow-auto p-4">
          <div v-if="loading" class="text-sm text-zinc-500">Loading…</div>
          <div v-else-if="assets.length === 0" class="text-sm text-zinc-500">
            No assets yet. Upload one to get started.
          </div>
          <div v-else class="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            <button
              v-for="a in assets"
              :key="a.id"
              type="button"
              class="group flex flex-col gap-1 rounded border border-zinc-200 p-2 text-left hover:border-zinc-400 hover:bg-zinc-50"
              @click="selectAsset(a)"
            >
              <div class="flex h-28 w-full items-center justify-center overflow-hidden rounded bg-zinc-50">
                <img v-if="isImage(a)" :src="thumbUrls[a.id] ?? a.url" alt="" class="h-full w-full object-cover" />
                <span v-else class="px-1 text-center text-[10px] text-zinc-500 break-all">
                  {{ a.originalName ?? a.key }}
                </span>
              </div>
              <span class="truncate text-xs text-zinc-700" :title="a.originalName ?? a.key">
                {{ a.originalName ?? a.key }}
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
