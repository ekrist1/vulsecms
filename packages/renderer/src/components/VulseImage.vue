<script setup lang="ts">
import { inject, computed } from 'vue';
import { buildImageUrl, type ImageModifiers } from '@vulse/image/url';

type ImageFormat = 'webp' | 'avif' | 'jpg' | 'png' | 'auto';
type ImageFit = 'cover' | 'contain' | 'inside' | 'outside';

interface AssetLike {
  id: string;
  imageWidth?: number | null;
  imageHeight?: number | null;
  originalName?: string | null;
  key?: string | null;
}

const props = withDefaults(
  defineProps<{
    asset: AssetLike;
    width?: number;
    height?: number;
    format?: ImageFormat;
    quality?: number;
    fit?: ImageFit;
    sizes?: string;
    widths?: number[];
    loading?: 'lazy' | 'eager';
    alt: string;
  }>(),
  {
    width: 1200,
    format: 'auto',
    quality: 75,
    fit: 'cover',
    loading: 'lazy',
  },
);

const secret = inject<string>('vulse:imageSecret', '');

const originalExt = computed(() => {
  const src = props.asset.originalName ?? props.asset.key ?? '';
  const dot = src.lastIndexOf('.');
  return dot >= 0 ? src.slice(dot + 1).toLowerCase() : 'jpg';
});

const heightAttr = computed(() => {
  if (props.height) return props.height;
  const { imageWidth, imageHeight } = props.asset;
  if (!imageWidth || !imageHeight) return undefined;
  return Math.round((props.width * imageHeight) / imageWidth);
});

function mods(w: number): ImageModifiers {
  const m: ImageModifiers = { w, f: props.format, q: props.quality, fit: props.fit };
  if (props.height) m.h = props.height;
  return m;
}

function url(w: number): string {
  return buildImageUrl({
    assetId: props.asset.id,
    mods: mods(w),
    secret,
    originalExt: originalExt.value,
  });
}

const widths = computed(() => {
  if (props.widths && props.widths.length) return props.widths;
  return Array.from(
    new Set(
      [Math.round(props.width * 0.5), props.width, props.width * 2].map((w) =>
        Math.min(Math.max(w, 16), 4096),
      ),
    ),
  ).sort((a, b) => a - b);
});

const src = computed(() => url(props.width));
const srcset = computed(() => widths.value.map((w) => `${url(w)} ${w}w`).join(', '));
</script>

<template>
  <img
    :src="src"
    :srcset="srcset"
    :sizes="sizes"
    :width="width"
    :height="heightAttr"
    :loading="loading"
    decoding="async"
    :alt="alt"
  />
</template>
