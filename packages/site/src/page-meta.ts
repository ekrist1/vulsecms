export interface SitePageMeta {
  layout?: string;
}

export function definePageMeta(_meta: SitePageMeta): void {
  // Compile-time macro target. The Vulse site Vite plugin extracts and strips
  // calls to this function from project page components.
}
