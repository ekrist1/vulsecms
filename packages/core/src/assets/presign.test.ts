import { describe, expect, it } from 'vitest';
import { buildObjectUrl, encodeS3Key, presignUrl, publicUrlFor } from './presign.js';
import type { S3Config } from './types.js';

const baseConfig: S3Config = {
  accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  region: 'us-east-1',
  bucket: 'examplebucket',
};

describe('presign', () => {
  it('builds a virtual-hosted style URL for AWS S3', () => {
    const { url, host } = buildObjectUrl(baseConfig, 'photos/cat.png');
    expect(host).toBe('examplebucket.s3.us-east-1.amazonaws.com');
    expect(url.pathname).toBe('/photos/cat.png');
  });

  it('uses path-style when a custom endpoint with forcePathStyle is set', () => {
    const { url, host } = buildObjectUrl(
      { ...baseConfig, endpoint: 'http://localhost:9000', forcePathStyle: true },
      'a/b.txt',
    );
    expect(host).toBe('localhost:9000');
    expect(url.pathname).toBe('/examplebucket/a/b.txt');
  });

  it('prefers publicBaseUrl for public URLs when set', () => {
    expect(
      publicUrlFor({ ...baseConfig, publicBaseUrl: 'https://cdn.example.com' }, 'k/file.png'),
    ).toBe('https://cdn.example.com/k/file.png');
  });

  it('encodes special characters in keys', () => {
    expect(encodeS3Key('my folder/file with spaces.png')).toBe(
      'my%20folder/file%20with%20spaces.png',
    );
  });

  it('returns a signed URL containing the AWS4 query params', () => {
    const url = presignUrl({
      config: baseConfig,
      method: 'PUT',
      key: 'k/file.png',
      contentType: 'image/png',
      now: new Date('2024-01-01T00:00:00Z'),
    });
    const parsed = new URL(url);
    expect(parsed.searchParams.get('X-Amz-Algorithm')).toBe('AWS4-HMAC-SHA256');
    expect(parsed.searchParams.get('X-Amz-Credential')).toContain('AKIAIOSFODNN7EXAMPLE');
    expect(parsed.searchParams.get('X-Amz-Date')).toBe('20240101T000000Z');
    expect(parsed.searchParams.get('X-Amz-SignedHeaders')).toContain('host');
    expect(parsed.searchParams.get('X-Amz-SignedHeaders')).toContain('content-type');
    expect(parsed.searchParams.get('X-Amz-Signature')).toMatch(/^[a-f0-9]{64}$/);
  });

  it('produces a deterministic signature for the same inputs', () => {
    const opts = {
      config: baseConfig,
      method: 'PUT' as const,
      key: 'k/file.png',
      now: new Date('2024-01-01T00:00:00Z'),
    };
    expect(presignUrl(opts)).toBe(presignUrl(opts));
  });
});
