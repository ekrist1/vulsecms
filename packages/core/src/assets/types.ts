import { z } from 'zod';

export const S3ConfigSchema = z.object({
  accessKeyId: z.string().min(1),
  secretAccessKey: z.string().min(1),
  region: z.string().min(1),
  bucket: z.string().min(1),
  endpoint: z.string().url().optional(),
  publicBaseUrl: z.string().url().optional(),
  forcePathStyle: z.boolean().optional(),
});

export type S3Config = z.infer<typeof S3ConfigSchema>;

export interface S3ConfigPublic {
  configured: boolean;
  accessKeyId: string | null;
  region: string | null;
  bucket: string | null;
  endpoint: string | null;
  publicBaseUrl: string | null;
  forcePathStyle: boolean;
}

export interface AssetDTO {
  id: string;
  key: string;
  bucket: string;
  url: string;
  contentType: string | null;
  size: number | null;
  originalName: string | null;
  createdAt: string;
}
