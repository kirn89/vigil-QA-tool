import { afterEach, describe, expect, it } from 'vitest';
import { env } from '../src/env.js';

const KEY = 'OPENROUTER_API_KEY';
const original = process.env[KEY];
afterEach(() => { if (original === undefined) delete process.env[KEY]; else process.env[KEY] = original; });

describe('env', () => {
  it('reads OPENROUTER_API_KEY when set', () => {
    process.env[KEY] = 'sk-or-test-123';
    expect(env('OPENROUTER_API_KEY')).toBe('sk-or-test-123');
  });
  it('throws a helpful error when a required var is missing', () => {
    delete process.env[KEY];
    expect(() => env('OPENROUTER_API_KEY')).toThrow(/OPENROUTER_API_KEY/);
  });
});
