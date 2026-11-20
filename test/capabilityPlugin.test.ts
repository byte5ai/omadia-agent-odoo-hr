/**
 * Capability-plugin contract (spec 2042 §5.10): tools go through
 * ctx.tools.register under instance-unique names, the manifest has no persona
 * surface, every registered tool has a side_effects entry.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { LocalSubAgentTool, NativeToolSpec, PluginContext } from '@omadia/plugin-api';

import { registerToolkitTools } from '../src/registerTools.js';
import { HR_TOOL_DOCS, HR_TOOL_NAMES, HR_TOOL_RENAME } from '../src/toolDocs.js';

const manifest = readFileSync(join(process.cwd(), 'manifest.yaml'), 'utf8');

interface Registered {
  readonly spec: NativeToolSpec;
  readonly handler: (input: unknown) => Promise<string>;
}

function fakeCtx(): { ctx: PluginContext; registered: Registered[] } {
  const registered: Registered[] = [];
  const ctx = {
    tools: {
      register(spec: NativeToolSpec, handler: Registered['handler']) {
        const entry = { spec, handler };
        registered.push(entry);
        return () => {
          registered.splice(registered.indexOf(entry), 1);
        };
      },
    },
  } as unknown as PluginContext;
  return { ctx, registered };
}

const graphTool: LocalSubAgentTool = {
  spec: {
    name: 'query_graph',
    description: 'Lookup. Use this BEFORE `odoo_execute` for master data.',
    input_schema: { type: 'object', properties: { model: { type: 'string' } }, required: ['model'] },
  },
  handle: async () => 'graph-result',
};
const executeTool: LocalSubAgentTool = {
  spec: {
    name: 'odoo_execute',
    description: 'Run a read-only call.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  handle: async () => ({ output: 'exec-result' }),
};

describe('registerToolkitTools', () => {
  it('registers under scope-prefixed names, rewrites cross references, appends docs', async () => {
    const { ctx, registered } = fakeCtx();
    const dispose = registerToolkitTools(ctx, [graphTool, executeTool], {
      rename: HR_TOOL_RENAME,
      docs: HR_TOOL_DOCS,
    });
    assert.deepEqual(registered.map((r) => r.spec.name), [HR_TOOL_NAMES.graph, HR_TOOL_NAMES.execute]);
    const graph = registered[0]!.spec;
    assert.ok(graph.description.includes(`BEFORE \`${HR_TOOL_NAMES.execute}\``));
    assert.ok(!/\bquery_graph\b|\bodoo_execute\b/.test(registered.map((r) => r.spec.description).join('\n')));
    assert.deepEqual(graph.input_schema.required, ['model']);
    assert.equal(registered[1]!.spec.input_schema.required, undefined);
    assert.ok(registered[1]!.spec.description.includes('Hard red lines'));
    assert.equal(await registered[0]!.handler({}), 'graph-result');
    assert.equal(await registered[1]!.handler({}), 'exec-result');
    dispose();
    assert.equal(registered.length, 0);
  });

  it('refuses a toolkit tool without an instance-unique name and unregisters the rest', () => {
    const { ctx, registered } = fakeCtx();
    const stray: LocalSubAgentTool = { ...executeTool, spec: { ...executeTool.spec, name: 'other_tool' } };
    assert.throws(
      () => registerToolkitTools(ctx, [graphTool, stray], { rename: HR_TOOL_RENAME }),
      /other_tool/,
    );
    assert.equal(registered.length, 0);
  });
});

describe('manifest as a capability plugin', () => {
  it('is kind tool, has no persona surface and ships en + de templates', () => {
    assert.match(manifest, /^ {2}kind: "tool"$/m);
    assert.doesNotMatch(manifest, /prompt_partial|^\s*persona:|system_prompt|^llm:/m);
    assert.doesNotMatch(manifest, /^ {2}memory:/m);
    assert.match(manifest, /language: "en"/);
    assert.match(manifest, /language: "de"/);
    assert.equal(existsSync(join(process.cwd(), 'AGENT.md')), false);
    assert.equal(existsSync(join(process.cwd(), 'skills')), false);
  });

  it('declares a read side effect for exactly the registered tool names', () => {
    const entries = [...manifest.matchAll(/- id: "(odoo_[a-z_]+)"\n(?: {4}.*\n)*? {4}side_effects: "(read|write|none)"/g)];
    const byId = Object.fromEntries(entries.map((m) => [m[1], m[2]]));
    assert.deepEqual(Object.keys(byId).sort(), Object.values(HR_TOOL_RENAME).sort());
    assert.ok(Object.values(byId).every((e) => e === 'read'));
  });
});
