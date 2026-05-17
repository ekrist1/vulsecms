import { createHash, createHmac } from 'node:crypto';
import type { S3Config } from './types.js';

const SERVICE = 's3';
const ALGORITHM = 'AWS4-HMAC-SHA256';
const UNSIGNED_PAYLOAD = 'UNSIGNED-PAYLOAD';

export interface PresignOptions {
  config: S3Config;
  method: 'PUT' | 'GET' | 'DELETE';
  key: string;
  expiresInSeconds?: number;
  contentType?: string;
  now?: Date;
}

export function buildObjectUrl(config: S3Config, key: string): { url: URL; host: string } {
  const encodedKey = encodeS3Key(key);
  if (config.endpoint) {
    const ep = new URL(config.endpoint);
    if (config.forcePathStyle) {
      ep.pathname = joinPath(ep.pathname, `/${config.bucket}/${encodedKey}`);
    } else {
      ep.hostname = `${config.bucket}.${ep.hostname}`;
      ep.pathname = joinPath(ep.pathname, `/${encodedKey}`);
    }
    return { url: ep, host: ep.host };
  }
  const host = `${config.bucket}.s3.${config.region}.amazonaws.com`;
  const url = new URL(`https://${host}/${encodedKey}`);
  return { url, host };
}

export function publicUrlFor(config: S3Config, key: string): string {
  if (config.publicBaseUrl) {
    const base = config.publicBaseUrl.endsWith('/')
      ? config.publicBaseUrl.slice(0, -1)
      : config.publicBaseUrl;
    return `${base}/${encodeS3Key(key)}`;
  }
  return buildObjectUrl(config, key).url.toString();
}

export function presignUrl(opts: PresignOptions): string {
  const { config, method, key } = opts;
  const expires = opts.expiresInSeconds ?? 900;
  const now = opts.now ?? new Date();

  const { url, host } = buildObjectUrl(config, key);

  const amzDate = formatAmzDate(now);
  const dateStamp = amzDate.slice(0, 8);
  const credentialScope = `${dateStamp}/${config.region}/${SERVICE}/aws4_request`;

  const headers: Record<string, string> = { host };
  if (opts.contentType && method === 'PUT') {
    headers['content-type'] = opts.contentType;
  }
  const signedHeaderNames = Object.keys(headers).sort();
  const signedHeaders = signedHeaderNames.join(';');

  const queryParams: Record<string, string> = {
    'X-Amz-Algorithm': ALGORITHM,
    'X-Amz-Credential': `${config.accessKeyId}/${credentialScope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(expires),
    'X-Amz-SignedHeaders': signedHeaders,
  };

  const canonicalQuery = Object.keys(queryParams)
    .sort()
    .map((k) => `${encodeRfc3986(k)}=${encodeRfc3986(queryParams[k]!)}`)
    .join('&');

  const canonicalHeaders = signedHeaderNames
    .map((h) => `${h}:${headers[h]!.trim().replace(/\s+/g, ' ')}\n`)
    .join('');

  const canonicalRequest = [
    method,
    url.pathname,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    UNSIGNED_PAYLOAD,
  ].join('\n');

  const stringToSign = [ALGORITHM, amzDate, credentialScope, sha256Hex(canonicalRequest)].join(
    '\n',
  );

  const signingKey = deriveSigningKey(config.secretAccessKey, dateStamp, config.region);
  const signature = hmac(signingKey, stringToSign).toString('hex');

  url.search = `${canonicalQuery}&X-Amz-Signature=${signature}`;
  return url.toString();
}

function deriveSigningKey(secret: string, dateStamp: string, region: string): Buffer {
  const kDate = hmac(`AWS4${secret}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, SERVICE);
  return hmac(kService, 'aws4_request');
}

function hmac(key: string | Buffer, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

function sha256Hex(data: string): string {
  return createHash('sha256').update(data, 'utf8').digest('hex');
}

function formatAmzDate(d: Date): string {
  return `${d
    .toISOString()
    .replace(/[:-]|\.\d{3}/g, '')
    .slice(0, 15)}Z`;
}

function encodeRfc3986(str: string): string {
  return encodeURIComponent(str).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

export function encodeS3Key(key: string): string {
  return key
    .split('/')
    .map((segment) => encodeRfc3986(segment))
    .join('/');
}

function joinPath(a: string, b: string): string {
  const left = a.endsWith('/') ? a.slice(0, -1) : a;
  const right = b.startsWith('/') ? b : `/${b}`;
  return `${left}${right}`;
}
