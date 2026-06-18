export interface ToolDef {
  name: string;
  description: string;
  input_schema: object;
}

export const MAP_TOOLS: ToolDef[] = [
  {
    name: 'navigate',
    description: 'Go to a path on the target app (e.g. "/login"). Returns the new page state (url + headings).',
    input_schema: { type: 'object', properties: { path: { type: 'string', description: 'Path beginning with /' } }, required: ['path'] },
  },
  {
    name: 'snapshot',
    description: 'List the interactive elements on the current page. Each entry has a ref (for click/fill/select), a role, a visible name, and a durable CSS selector you MUST use when proposing flow steps. Destructive links (logout/delete) are hidden — do not attempt them.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'read_state',
    description: 'Get the current page state (url path + visible headings) without changing anything.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'click',
    description: 'Click an element by its ref from the latest snapshot. Returns the new page state.',
    input_schema: { type: 'object', properties: { ref: { type: 'string' } }, required: ['ref'] },
  },
  {
    name: 'fill',
    description: 'Type a value into an input/textarea by its ref from the latest snapshot.',
    input_schema: { type: 'object', properties: { ref: { type: 'string' }, value: { type: 'string' } }, required: ['ref', 'value'] },
  },
  {
    name: 'select',
    description: 'Choose an option in a native <select> dropdown by its ref. Value matches the option value or visible label.',
    input_schema: { type: 'object', properties: { ref: { type: 'string' }, value: { type: 'string' } }, required: ['ref', 'value'] },
  },
  {
    name: 'propose_flows',
    description: 'Submit the critical user journeys you discovered, as golden paths. Each step action kind is one of: goto{path}, fill{selector,value,description}, select{selector,value,description}, upload{selector,path,description}, click{selector,description}, expect_text{text}, expect_url{pattern}. Use the durable selectors from snapshots. For credentials use the placeholders {{email}} and {{password}}. End each flow with expect_url and/or expect_text on stable post-action content. Call this once with all flows when you are done exploring.',
    input_schema: {
      type: 'object',
      properties: {
        flows: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              steps: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: { id: { type: 'string' }, action: { type: 'object' } },
                  required: ['id', 'action'],
                },
              },
            },
            required: ['name', 'steps'],
          },
        },
      },
      required: ['flows'],
    },
  },
];
