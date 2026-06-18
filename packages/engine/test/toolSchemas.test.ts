import { describe, expect, it } from 'vitest';
import { MAP_TOOLS } from '../src/map/toolSchemas.js';

describe('MAP_TOOLS', () => {
  it('exposes the browser tools and propose_flows', () => {
    const names = MAP_TOOLS.map((t) => t.name).sort();
    expect(names).toEqual(['click', 'fill', 'navigate', 'propose_flows', 'read_state', 'select', 'snapshot']);
  });
  it('every tool has a description and an object input_schema', () => {
    for (const t of MAP_TOOLS) {
      expect(t.description.length).toBeGreaterThan(10);
      expect((t.input_schema as { type: string }).type).toBe('object');
    }
  });
  it('propose_flows takes a flows array of {name, steps}', () => {
    const propose = MAP_TOOLS.find((t) => t.name === 'propose_flows')!;
    const schema = propose.input_schema as { properties: { flows: { type: string } }; required: string[] };
    expect(schema.properties.flows.type).toBe('array');
    expect(schema.required).toContain('flows');
  });
});
