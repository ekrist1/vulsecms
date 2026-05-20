import { describe, expect, it } from 'vitest';
import {
  type ImageModifiers,
  parseModifiers,
  serializeModifiers,
} from '../modifiers.js';

describe('modifiers', () => {
  it('parses width/height/format/quality', () => {
    expect(parseModifiers('w_800,h_600,f_webp,q_75')).toEqual({
      w: 800,
      h: 600,
      f: 'webp',
      q: 75,
    });
  });

  it('parses fit and pos', () => {
    expect(parseModifiers('w_800,fit_cover,pos_top')).toEqual({
      w: 800,
      fit: 'cover',
      pos: 'top',
    });
  });

  it('rejects unknown keys', () => {
    expect(() => parseModifiers('w_800,evil_1')).toThrow(/unknown modifier/);
  });

  it('rejects out-of-range width', () => {
    expect(() => parseModifiers('w_99999')).toThrow(/out of range/);
    expect(() => parseModifiers('w_0')).toThrow(/out of range/);
  });

  it('rejects invalid format', () => {
    expect(() => parseModifiers('f_bmp')).toThrow(/invalid format/);
  });

  it('rejects invalid fit', () => {
    expect(() => parseModifiers('fit_squash')).toThrow(/invalid fit/);
  });

  it('rejects non-integer width', () => {
    expect(() => parseModifiers('w_abc')).toThrow();
  });

  it('serializeModifiers produces a canonical sorted string', () => {
    const mods: ImageModifiers = { f: 'webp', w: 800, q: 75 };
    expect(serializeModifiers(mods)).toBe('f_webp,q_75,w_800');
  });

  it('round-trips through parse/serialize', () => {
    const input = 'fit_cover,h_600,w_800';
    expect(serializeModifiers(parseModifiers(input))).toBe(input);
  });
});
