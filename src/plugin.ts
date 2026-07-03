/**
 * Odoo HR Sub-Agent — extracted from middleware kernel in Phase 5B M3+M4
 * catch-up. Mirrors the accounting-agent shape; the only differences are
 * the consumed service name and the runtime-note skill body.
 */

import type { PluginContext } from '@omadia/plugin-api';
import type { LocalSubAgentTool } from '@omadia/plugin-api';
import { createGraphLookupTool } from '@omadia/verifier';

import { createHrUiRouter } from './routes/hrUiRouter.js';
import type { OdooExecutor } from './routes/hrDataSource.js';

const EXECUTE_TOOL_SERVICE = 'odoo.executeTool.hr';
const ODOO_CLIENT_SERVICE = 'odoo.client';
const KNOWLEDGE_GRAPH_SERVICE = 'knowledgeGraph';

interface MinimalKnowledgeGraph {
  readonly [k: string]: unknown;
}

export interface HrHandle {
  readonly toolkit: { tools: LocalSubAgentTool[] };
  close(): Promise<void>;
}

export async function activate(ctx: PluginContext): Promise<HrHandle> {
  ctx.log('activating odoo-hr agent');

  const executeTool = ctx.services.get<LocalSubAgentTool>(EXECUTE_TOOL_SERVICE);
  if (!executeTool) {
    throw new Error(
      `agent-odoo-hr: required service '${EXECUTE_TOOL_SERVICE}' not published — @omadia/integration-odoo must be active before this agent (declared in depends_on).`,
    );
  }

  const graph = ctx.services.get<MinimalKnowledgeGraph>(KNOWLEDGE_GRAPH_SERVICE);
  if (!graph) {
    throw new Error(
      `agent-odoo-hr: required service '${KNOWLEDGE_GRAPH_SERVICE}' not published — declared in requires.knowledgeGraph@1.`,
    );
  }

  const graphLookup = createGraphLookupTool('hr', {
    graph: graph as unknown as Parameters<typeof createGraphLookupTool>[1]['graph'],
  });

  // Plugin-served HR dashboards. Mounted at /p/agent-odoo-hr/{birthdays,
  // absences} — pinned as Teams Tabs through the channel-teams configurable-
  // tab flow. Reads live from Odoo HR via the shared `odoo.client` service
  // (published by @omadia/integration-odoo). Route handlers catch fetch
  // failures and render an inline banner, so a transient Odoo outage
  // degrades the Tab gracefully instead of 500ing.
  const odooClient = ctx.services.get<OdooExecutor>(ODOO_CLIENT_SERVICE);
  if (!odooClient) {
    throw new Error(
      `agent-odoo-hr: required service '${ODOO_CLIENT_SERVICE}' not published — @omadia/integration-odoo must publish OdooClient before this agent.`,
    );
  }
  const hrUiRouter = createHrUiRouter({
    odooClient,
    log: (...args) => ctx.log(...args),
  });
  const disposeHrUi = ctx.routes.register('/p/agent-odoo-hr', hrUiRouter);
  const disposeBirthdaysDescriptor = ctx.uiRoutes.register({
    routeId: 'birthdays',
    path: '/birthdays',
    title: 'Odoo-HR — Geburtstage',
    description:
      'Live aus Odoo HR (hr.employee): heute & nächste 4 Wochen. Auto-Refresh 60 s.',
    order: 10,
  });
  const disposeAbsencesDescriptor = ctx.uiRoutes.register({
    routeId: 'absences',
    path: '/absences',
    title: 'Odoo-HR — Abwesenheiten',
    description:
      'Live aus Odoo HR (hr.leave): heute weg + nächste 60 Tage geplant. Auto-Refresh 60 s.',
    order: 20,
  });
  ctx.log(
    'odoo-hr uiRoutes mounted at /p/agent-odoo-hr/{birthdays,absences}',
  );

  ctx.log(
    `odoo-hr ready (tools=2: ${graphLookup.spec.name}, ${executeTool.spec.name})`,
  );

  return {
    toolkit: { tools: [graphLookup, executeTool] },
    async close() {
      ctx.log('deactivating odoo-hr agent');
      disposeHrUi();
      disposeBirthdaysDescriptor();
      disposeAbsencesDescriptor();
    },
  };
}
