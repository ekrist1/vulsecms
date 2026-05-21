<script setup lang="ts">
import type { ImageModifiers } from '@vulse/image/url';
import { computed, inject } from 'vue';

type ImageFormat = 'webp' | 'avif' | 'jpg' | 'png' | 'auto';
type ImageFit = 'cover' | 'contain' | 'inside' | 'outside';

interface AssetLike {
  id: string;
  imageWidth?: number | null;
  imageHeight?: number | null;
  originalName?: string | null;
  key?: string | null;
  url?: string | null;
  src?: string | null;
}

interface ImageUrlBuilderInput {
  assetId: string;
  mods: ImageModifiers;
  originalExt?: string;
}

type ImageUrlBuilder = (input: ImageUrlBuilderInput) => string;

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

const imageUrlBuilder = inject<ImageUrlBuilder | null>('vulse:buildImageUrl', null);

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

const fallbackUrl = computed(() => {
  if (typeof props.asset.url === 'string') return props.asset.url;
  if (typeof props.asset.src === 'string') return props.asset.src;
  return '';
});

function url(w: number): string {
  if (!imageUrlBuilder) return fallbackUrl.value;
  return imageUrlBuilder({
    assetId: props.asset.id,
    mods: mods(w),
    originalExt: originalExt.value,
  });
}

const widths = computed(() => {
  if (props.widths?.length) return props.widths;
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
