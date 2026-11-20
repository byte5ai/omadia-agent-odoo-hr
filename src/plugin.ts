/**
 * Odoo HR capability plugin (kind `tool`, spec 2042 §5.10, ADR-0014) plus the
 * plugin-served HR dashboards.
 *
 * The toolkit (`query_graph` + `odoo_execute`, scope `hr`) is assembled once
 * in @omadia/integration-odoo and published as the `odoo.agentToolkit.hr`
 * service. This plugin registers each of its tools via `ctx.tools.register`
 * (`registerTools.ts`) under an instance-unique name and returns `{ close }`.
 * It has no persona, no system prompt and no sub-agent: the former persona
 * ships as agent templates in manifest.yaml, the tool knowledge is in the
 * tool descriptions (`toolDocs.ts`).
 *
 * On top of the tools, the plugin mounts its own Teams dashboards (birthdays /
 * absences) — HR-specific UI, not shared agent plumbing.
 *
 * Requires @omadia/integration-odoo >= 0.2.0 (publishes odoo.agentToolkit.*).
 */

import type { LocalSubAgentTool, PluginContext } from '@omadia/plugin-api';

import { registerToolkitTools } from './registerTools.js';
import { HR_TOOL_DOCS, HR_TOOL_RENAME } from './toolDocs.js';
import { createHrTeamsDataRouter, createHrUiRouter } from './routes/hrUiRouter.js';
import type { OdooExecutor } from './routes/hrDataSource.js';
import {
  TEAMS_TAB_DATA_SEGMENT,
  TEAMS_TAB_SEGMENT,
  createTeamsTabRouters,
} from './routes/teamsTabRouter.js';

const AGENT_TOOLKIT_SERVICE = 'odoo.agentToolkit.hr';
const ODOO_CLIENT_SERVICE = 'odoo.client';

/** Browser mount (operator session). */
export const UI_MOUNT_PATH = '/p/agent-odoo-hr';
/** Teams-tab mount — must equal the manifest's permissions.public_paths entry. */
export const TEAMS_MOUNT_PATH = UI_MOUNT_PATH + TEAMS_TAB_SEGMENT;

const PAGES = [
  {
    routeId: 'birthdays',
    path: '/birthdays',
    title: 'Odoo-HR — Geburtstage',
    description:
      'Live aus Odoo HR (hr.employee): heute & nächste 4 Wochen. Auto-Refresh 60 s.',
    order: 10,
  },
  {
    routeId: 'absences',
    path: '/absences',
    title: 'Odoo-HR — Abwesenheiten',
    description:
      'Live aus Odoo HR (hr.leave): heute weg + nächste 60 Tage geplant, im Teams-Tab ohne Abwesenheitsart. Auto-Refresh 60 s.',
    order: 20,
  },
] as const;

/** Structural shim for the service value published by integration-odoo. */
interface OdooAgentToolkit {
  readonly tools: LocalSubAgentTool[];
}

export interface HrHandle {
  close(): Promise<void>;
}

export async function activate(ctx: PluginContext): Promise<HrHandle> {
  ctx.log('activating odoo-hr tools');

  const toolkit = ctx.services.get<OdooAgentToolkit>(AGENT_TOOLKIT_SERVICE);
  if (!toolkit) {
    throw new Error(
      `agent-odoo-hr: required service '${AGENT_TOOLKIT_SERVICE}' not published — @omadia/integration-odoo (>= 0.2.0) must be active before this agent (declared in depends_on).`,
    );
  }

  // Plugin-served HR dashboards (birthdays / absences), read live from Odoo HR
  // via the shared `odoo.client` service (published by @omadia/integration-
  // odoo). Route handlers catch fetch failures and render an inline banner.
  //
  // Two surfaces (omadia#1620):
  //   /p/agent-odoo-hr/<page>              browser, operator session, full view
  //   /p/agent-odoo-hr/teams/<page>        data-free Teams shell, public
  //   /p/agent-odoo-hr/teams/_data/<page>  Teams SSO (any tenant member);
  //                                        absences WITHOUT the leave type
  const odooClient = ctx.services.get<OdooExecutor>(ODOO_CLIENT_SERVICE);
  if (!odooClient) {
    throw new Error(
      `agent-odoo-hr: required service '${ODOO_CLIENT_SERVICE}' not published — @omadia/integration-odoo must publish OdooClient before this agent.`,
    );
  }
  const routerOpts = { odooClient, log: (...args: unknown[]) => ctx.log(...args) };
  const teamsTab = createTeamsTabRouters({
    mountPath: TEAMS_MOUNT_PATH,
    dataSegment: TEAMS_TAB_DATA_SEGMENT,
    pages: PAGES.map((p) => ({ path: p.path, title: p.title })),
    dataRouter: createHrTeamsDataRouter(routerOpts),
  });
  const disposers: Array<() => void> = [
    ctx.routes.register(UI_MOUNT_PATH, createHrUiRouter(routerOpts), { auth: 'session' }),
    ctx.routes.register(TEAMS_MOUNT_PATH, teamsTab.shell, { auth: 'public' }),
    ctx.routes.register(TEAMS_MOUNT_PATH + TEAMS_TAB_DATA_SEGMENT, teamsTab.data, {
      auth: 'teams-sso',
    }),
    // The descriptor path is what channel-teams pins as the tab URL → the shell.
    ...PAGES.map((p) =>
      ctx.uiRoutes.register({
        routeId: p.routeId,
        path: TEAMS_TAB_SEGMENT + p.path,
        title: p.title,
        description: p.description,
        order: p.order,
      }),
    ),
  ];
  ctx.log(
    `odoo-hr uiRoutes mounted at ${UI_MOUNT_PATH}/{birthdays,absences} (session) + ${TEAMS_MOUNT_PATH}/{birthdays,absences} (Teams SSO)`,
  );

  // Every toolkit tool goes to the kernel's tool runtime.
  try {
    disposers.push(
      registerToolkitTools(ctx, toolkit.tools, { rename: HR_TOOL_RENAME, docs: HR_TOOL_DOCS }),
    );
  } catch (err) {
    for (const dispose of disposers) dispose();
    throw err;
  }

  ctx.log(
    `odoo-hr ready (tools=${String(toolkit.tools.length)}: ${toolkit.tools
      .map((t) => t.spec.name)
      .join(', ')})`,
  );

  return {
    async close() {
      ctx.log('deactivating odoo-hr tools');
      for (const dispose of disposers) dispose();
    },
  };
}
