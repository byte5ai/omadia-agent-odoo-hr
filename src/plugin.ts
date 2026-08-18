/**
 * Odoo HR Sub-Agent — thin consumer + plugin-served HR dashboards.
 *
 * Phase 6: the LocalSubAgent toolkit (`query_graph` + `odoo_execute`) is now
 * assembled once in @omadia/integration-odoo and published as the
 * `odoo.agentToolkit.hr` service. This plugin just consumes it — the graph-
 * lookup wiring (and the @omadia/verifier dependency it needed) moved into the
 * integration, collapsing the boilerplate this package and
 * @omadia/agent-odoo-accounting used to duplicate.
 *
 * On top of the shared toolkit, the HR agent additionally mounts its own Teams
 * dashboards (birthdays / absences) — that part stays here because it is
 * HR-specific UI, not shared agent plumbing.
 *
 * Requires @omadia/integration-odoo >= 0.2.0 (publishes odoo.agentToolkit.*).
 */

import type { PluginContext } from '@omadia/plugin-api';
import type { LocalSubAgentTool } from '@omadia/plugin-api';

import { createHrUiRouter } from './routes/hrUiRouter.js';
import type { OdooExecutor } from './routes/hrDataSource.js';

const AGENT_TOOLKIT_SERVICE = 'odoo.agentToolkit.hr';
const ODOO_CLIENT_SERVICE = 'odoo.client';

/** Structural shim for the service value published by integration-odoo. */
interface OdooAgentToolkit {
  readonly tools: LocalSubAgentTool[];
}

export interface HrHandle {
  readonly toolkit: { tools: LocalSubAgentTool[] };
  close(): Promise<void>;
}

export async function activate(ctx: PluginContext): Promise<HrHandle> {
  ctx.log('activating odoo-hr agent');

  const toolkit = ctx.services.get<OdooAgentToolkit>(AGENT_TOOLKIT_SERVICE);
  if (!toolkit) {
    throw new Error(
      `agent-odoo-hr: required service '${AGENT_TOOLKIT_SERVICE}' not published — @omadia/integration-odoo (>= 0.2.0) must be active before this agent (declared in depends_on).`,
    );
  }

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
  ctx.log('odoo-hr uiRoutes mounted at /p/agent-odoo-hr/{birthdays,absences}');

  ctx.log(
    `odoo-hr ready (tools=${String(toolkit.tools.length)}: ${toolkit.tools
      .map((t) => t.spec.name)
      .join(', ')})`,
  );

  return {
    toolkit: { tools: toolkit.tools },
    async close() {
      ctx.log('deactivating odoo-hr agent');
      disposeHrUi();
      disposeBirthdaysDescriptor();
      disposeAbsencesDescriptor();
    },
  };
}
