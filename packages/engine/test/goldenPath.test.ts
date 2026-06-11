import { describe, expect, it } from 'vitest';
import { goldenPathSchema, interpolate } from '../src/flows/goldenPath.js';

const loginFlow = {
  name: 'login',
  requiresLogin: false,
  steps: [
    { id: 's1', action: { kind: 'goto', path: '/login' } },
    { id: 's2', action: { kind: 'fill', selector: 'input[name=email]', value: '{{email}}', description: 'email field' } },
    { id: 's3', action: { kind: 'fill', selector: 'input[name=password]', value: '{{password}}', description: 'password field' } },
    { id: 's4', action: { kind: 'click', selector: 'button[type=submit]', description: 'Sign in button' } },
    { id: 's5', action: { kind: 'expect_url', pattern: '/dashboard$' } },
    { id: 's6', action: { kind: 'expect_text', text: 'Welcome back' } },
  ],
};

describe('goldenPathSchema', () => {
  it('parses a valid flow', () => {
    expect(goldenPathSchema.parse(loginFlow).steps).toHaveLength(6);
  });

  it('rejects an unknown action kind', () => {
    const bad = { ...loginFlow, steps: [{ id: 'x', action: { kind: 'drag' } }] };
    expect(() => goldenPathSchema.parse(bad)).toThrow();
  });

  it('rejects more than 30 steps', () => {
    const big = { ...loginFlow, steps: Array.from({ length: 31 }, (_, i) => ({ id: `s${i}`, action: { kind: 'goto', path: '/' } })) };
    expect(() => goldenPathSchema.parse(big)).toThrow();
  });
});

describe('interpolate', () => {
  const ctx = { email: 'demo@example.com', password: 'demo-pass', runId: 'r1' };
  it('substitutes credentials', () => {
    expect(interpolate('{{email}}', ctx)).toBe('demo@example.com');
    expect(interpolate('{{password}}', ctx)).toBe('demo-pass');
  });
  it('marks synthetic data clearly (spec §6 run hygiene)', () => {
    expect(interpolate('{{unique}}@example.com', ctx)).toBe('vigil-test+r1@example.com');
  });
});
