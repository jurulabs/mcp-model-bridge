import { describe, expect, it } from 'vitest';
import { stripBom } from './text.js';

const BOM = '\uFEFF';

describe('stripBom', () => {
  it('removes a leading byte order mark', () => {
    expect(stripBom(`${BOM}{"a":1}`)).toBe('{"a":1}');
  });

  it('leaves content without a mark untouched', () => {
    expect(stripBom('{"a":1}')).toBe('{"a":1}');
  });

  it('removes only one mark, so a second is treated as content', () => {
    expect(stripBom(`${BOM}${BOM}x`)).toBe(`${BOM}x`);
  });

  it('does not touch a mark that appears later in the text', () => {
    expect(stripBom(`x${BOM}y`)).toBe(`x${BOM}y`);
  });

  it('handles an empty string', () => {
    expect(stripBom('')).toBe('');
  });
});

