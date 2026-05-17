<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { type S3SettingsPublic, api } from '../api/client.js';
import { useToastsStore } from '../stores/toasts.js';

const toasts = useToastsStore();
const current = ref<S3SettingsPublic | null>(null);
const loading = ref(false);
const saving = ref(false);

const form = reactive({
  accessKeyId: '',
  secretAccessKey: '',
  region: 'us-east-1',
  bucket: '',
  endpoint: '',
  publicBaseUrl: '',
  forcePathStyle: false,
});

async function load() {
  loading.value = true;
  try {
    const cfg = await api.getS3Settings();
    current.value = cfg;
    if (cfg.configured) {
      form.region = cfg.region ?? form.region;
      form.bucket = cfg.bucket ?? '';
      form.endpoint = cfg.endpoint ?? '';
      form.publicBaseUrl = cfg.publicBaseUrl ?? '';
      form.forcePathStyle = cfg.forcePathStyle;
    }
  } catch {
    toasts.error('Could not load S3 settings');
  } finally {
    loading.value = false;
  }
}

async function save() {
  if (!form.accessKeyId || !form.secretAccessKey || !form.region || !form.bucket) {
    toasts.error('Access key, secret, region and bucket are required.');
    return;
  }
  saving.value = true;
  try {
    const body = {
      accessKeyId: form.accessKeyId.trim(),
      secretAccessKey: form.secretAccessKey,
      region: form.region.trim(),
      bucket: form.bucket.trim(),
      ...(form.endpoint.trim() ? { endpoint: form.endpoint.trim() } : {}),
      ...(form.publicBaseUrl.trim() ? { publicBaseUrl: form.publicBaseUrl.trim() } : {}),
      forcePathStyle: form.forcePathStyle,
    };
    current.value = await api.saveS3Settings(body);
    form.accessKeyId = '';
    form.secretAccessKey = '';
    toasts.success('S3 settings saved');
  } catch (e) {
    const err = e as { response?: { message?: string } };
    toasts.error(err.response?.message ?? 'Could not save S3 settings');
  } finally {
    saving.value = false;
  }
}

async function clear() {
  if (!confirm('Remove S3 configuration? Uploads will stop working.')) return;
  try {
    await api.clearS3Settings();
    toasts.success('S3 configuration cleared');
    current.value = null;
    form.accessKeyId = '';
    form.secretAccessKey = '';
    form.bucket = '';
    form.endpoint = '';
    form.publicBaseUrl = '';
    form.forcePathStyle = false;
  } catch {
    toasts.error('Could not clear settings');
  }
}

onMounted(load);
</script>

<template>
  <div class="p-6">
    <h1 class="mb-1 text-xl font-semibold">S3 Storage</h1>
    <p class="mb-4 max-w-2xl text-sm text-zinc-600">
      Configure an S3-compatible bucket (AWS S3, Cloudflare R2, MinIO, Backblaze B2…).
      The admin uploads files directly to your bucket using presigned URLs; the access keys are
      stored server-side and never sent to the browser.
    </p>

    <div
      v-if="current?.configured"
      class="mb-6 rounded border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900"
      data-testid="s3-status-configured"
    >
      <div class="font-medium">S3 is configured</div>
      <dl class="mt-2 grid grid-cols-[120px_1fr] gap-y-1 text-xs">
        <dt class="text-emerald-700">Access key</dt><dd class="font-mono">{{ current.accessKeyId }}</dd>
        <dt class="text-emerald-700">Bucket</dt><dd class="font-mono">{{ current.bucket }}</dd>
        <dt class="text-emerald-700">Region</dt><dd class="font-mono">{{ current.region }}</dd>
        <dt v-if="current.endpoint" class="text-emerald-700">Endpoint</dt>
        <dd v-if="current.endpoint" class="font-mono">{{ current.endpoint }}</dd>
        <dt v-if="current.publicBaseUrl" class="text-emerald-700">Public URL base</dt>
        <dd v-if="current.publicBaseUrl" class="font-mono">{{ current.publicBaseUrl }}</dd>
        <dt class="text-emerald-700">Path style</dt>
        <dd>{{ current.forcePathStyle ? 'yes' : 'no' }}</dd>
      </dl>
    </div>

    <form class="max-w-2xl space-y-3" data-testid="s3-settings-form" @submit.prevent="save">
      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label class="block">
          <span class="block text-xs font-medium text-zinc-600">Access key ID</span>
          <input
            v-model="form.accessKeyId"
            type="text"
            autocomplete="off"
            placeholder="AKIA…"
            class="mt-1 w-full rounded border border-zinc-300 px-3 py-2 text-sm font-mono"
            data-testid="s3-access-key"
          />
        </label>
        <label class="block">
          <span class="block text-xs font-medium text-zinc-600">Secret access key</span>
          <input
            v-model="form.secretAccessKey"
            type="password"
            autocomplete="new-password"
            class="mt-1 w-full rounded border border-zinc-300 px-3 py-2 text-sm font-mono"
            data-testid="s3-secret-key"
          />
        </label>
        <label class="block">
          <span class="block text-xs font-medium text-zinc-600">Region</span>
          <input
            v-model="form.region"
            type="text"
            placeholder="us-east-1"
            class="mt-1 w-full rounded border border-zinc-300 px-3 py-2 text-sm font-mono"
            data-testid="s3-region"
          />
        </label>
        <label class="block">
          <span class="block text-xs font-medium text-zinc-600">Bucket</span>
          <input
            v-model="form.bucket"
            type="text"
            placeholder="my-bucket"
            class="mt-1 w-full rounded border border-zinc-300 px-3 py-2 text-sm font-mono"
            data-testid="s3-bucket"
          />
        </label>
      </div>

      <label class="block">
        <span class="block text-xs font-medium text-zinc-600">
          Endpoint <span class="text-zinc-400">(optional, for S3-compatible providers)</span>
        </span>
        <input
          v-model="form.endpoint"
          type="url"
          placeholder="https://s3.example-provider.com"
          class="mt-1 w-full rounded border border-zinc-300 px-3 py-2 text-sm font-mono"
          data-testid="s3-endpoint"
        />
      </label>

      <label class="block">
        <span class="block text-xs font-medium text-zinc-600">
          Public URL base <span class="text-zinc-400">(optional, e.g. CDN domain)</span>
        </span>
        <input
          v-model="form.publicBaseUrl"
          type="url"
          placeholder="https://cdn.example.com"
          class="mt-1 w-full rounded border border-zinc-300 px-3 py-2 text-sm font-mono"
          data-testid="s3-public-url"
        />
      </label>

      <label class="flex items-center gap-2 text-sm">
        <input
          v-model="form.forcePathStyle"
          type="checkbox"
          class="rounded border-zinc-300"
          data-testid="s3-force-path-style"
        />
        <span>Force path-style URLs (required for MinIO and some providers)</span>
      </label>

      <div class="flex items-center gap-2 pt-2">
        <button
          type="submit"
          class="rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50"
          :disabled="saving"
          data-testid="s3-save"
        >
          {{ saving ? 'Saving…' : current?.configured ? 'Update settings' : 'Save settings' }}
        </button>
        <button
          v-if="current?.configured"
          type="button"
          class="rounded border border-zinc-300 bg-white px-4 py-2 text-sm text-red-700 hover:bg-red-50"
          data-testid="s3-clear"
          @click="clear"
        >
          Clear
        </button>
      </div>
      <p class="text-xs text-zinc-500">
        Leave the access key blank when updating to keep the existing key; submitting requires the
        full credentials.
      </p>
    </form>
  </div>
</template>
