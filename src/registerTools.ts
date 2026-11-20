import type {
  LocalSubAgentTool,
  NativeToolSpec,
  PluginContext,
} from '@omadia/plugin-api';

/**
 * Tool-runtime contract (spec 2042 §5.10, ADR-0014): a capability plugin
 * registers each tool with the kernel via `ctx.tools.register(spec, handler)`.
 * The kernel offers the tools to the agents the operator granted this plugin
 * to; the calling agent decides when to use them. This plugin has no persona,
 * no system prompt and no model loop of its own.
 *
 * The tools are built by `@omadia/integration-odoo` and published as the
 * `odoo.agentToolkit.hr` service (a scope-locked `LocalSubAgentTool[]`).
 * Inside the old sub-agent the tool names `query_graph` and `odoo_execute`
 * were private; as native tools they are instance-wide, and the accounting
 * toolkit uses the same two names. Each tool is therefore registered under a
 * scope-prefixed name (`rename`), and references to the old names inside a
 * description are rewritten to match.
 */

export interface RegisterToolkitOptions {
  /** Original tool name → instance-unique name. */
  readonly rename: Readonly<Record<string, string>>;
  /** Text appended to a description, keyed by the NEW tool name. */
  readonly docs?: Readonly<Record<string, string>>;
}

function renameInText(text: string, rename: Readonly<Record<string, string>>): string {
  const names = Object.keys(rename);
  if (names.length === 0) return text;
  const pattern = new RegExp(`\\b(${names.join('|')})\\b`, 'g');
  return text.replace(pattern, (match) => rename[match] ?? match);
}

/**
 * Register every toolkit tool with the kernel. The handler returns the text
 * of the tool result: a string verbatim, a structured result as its `output`.
 * A tool of the toolkit that `rename` does not cover is a bug: it would take
 * a name another plugin may hold, so it throws.
 *
 * Returns one dispose function that unregisters every tool; call it from
 * `close()`.
 */
export function registerToolkitTools(
  ctx: PluginContext,
  tools: readonly LocalSubAgentTool[],
  opts: RegisterToolkitOptions,
): () => void {
  const disposers: Array<() => void> = [];
  try {
    for (const tool of tools) {
      const name = opts.rename[tool.spec.name];
      if (name === undefined) {
        throw new Error(
          `agent-odoo-hr: toolkit tool '${tool.spec.name}' has no instance-unique name; add it to the rename map`,
        );
      }
      const description = renameInText(tool.spec.description, opts.rename);
      const extra = opts.docs?.[name];
      const spec: NativeToolSpec = {
        name,
        description: extra ? `${description}\n\n${extra}` : description,
        input_schema: {
          type: 'object',
          properties: tool.spec.input_schema.properties,
          ...(tool.spec.input_schema.required.length > 0
            ? { required: tool.spec.input_schema.required }
            : {}),
        },
      };
      disposers.push(
        ctx.tools.register(spec, async (input) => {
          const result = await tool.handle(input);
          return typeof result === 'string' ? result : result.output;
        }),
      );
    }
  } catch (err) {
    for (const dispose of disposers) dispose();
    throw err;
  }
  return () => {
    for (const dispose of disposers) dispose();
  };
}
