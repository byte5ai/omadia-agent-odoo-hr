/**
 * Teams-tab surface for the HR pages (byte5ai/omadia#1620). Mirrors the core
 * codegen's `routes/teamsTabRouter.ts` (middleware/src/plugins/builder/
 * codegenUiRoute.ts → renderTeamsTabFile):
 *
 *   <mountPath><path>           data-free shell, auth:'public'
 *   <mountPath>/_data<path>     the HR page,     auth:'teams-sso'
 *
 * The kernel serves both only while the operator grants the manifest's
 * permissions.public_paths entry `/p/agent-odoo-hr/teams`. The data mount
 * opens for a verified Microsoft Teams SSO token of a tenant member and for
 * nothing else — an omadia session cookie does not open it. The shell never
 * touches data.
 */

import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import { renderRoute, htmlDoc, html, safe } from '@omadia/plugin-ui-helpers';

const TEAMS_JS_URL =
  'https://res.cdn.office.net/teams-js/2.34.0/js/MicrosoftTeams.min.js';
/** Subresource integrity of exactly that file — the script runs in the
 *  plugin's origin, so a swapped CDN file must not load. */
const TEAMS_JS_INTEGRITY =
  'sha384-brW9AazbKR2dYw2DucGgWCCcmrm2oBFV4HQidyuyZRI/TnAkmOOnTARSTdps3Hwt';

/** How long the shell waits for `app.initialize()` before giving up. */
const TEAMS_INIT_TIMEOUT_MS = 8000;

export const TEAMS_TAB_SEGMENT = '/teams';
export const TEAMS_TAB_DATA_SEGMENT = '/_data';

export interface TeamsTabPage {
  readonly path: string;
  readonly title: string;
}

export interface TeamsTabRouterOptions {
  /** Absolute mount of the shell router, e.g. `/p/agent-odoo-hr/teams`. */
  readonly mountPath: string;
  /** Data mount below mountPath, e.g. `/_data`. */
  readonly dataSegment: string;
  readonly pages: readonly TeamsTabPage[];
  /** ONE router serving every page path. The kernel dispatches a granted
   *  path to a single route entry, so several routers on one prefix would
   *  serve only the first. */
  readonly dataRouter: Router;
}

function shellScript(dataUrl: string): string {
  return `
    (function () {
      var status = document.getElementById('omadia-status');
      var show = function (message) { if (status) status.textContent = message; };
      var sdk = new Promise(function (resolve, reject) {
        var s = document.createElement('script');
        s.src = ${JSON.stringify(TEAMS_JS_URL)};
        s.integrity = ${JSON.stringify(TEAMS_JS_INTEGRITY)};
        s.crossOrigin = 'anonymous';
        s.onload = function () { resolve(window.microsoftTeams); };
        s.onerror = function () { reject(new Error('Teams SDK failed to load.')); };
        document.head.appendChild(s);
      });
      var outsideTeams = new Promise(function (_resolve, reject) {
        setTimeout(function () {
          reject(new Error('Open this page inside Microsoft Teams.'));
        }, ${String(TEAMS_INIT_TIMEOUT_MS)});
      });
      Promise.race([
        sdk.then(function (t) { return t.app.initialize().then(function () { return t; }); }),
        outsideTeams,
      ]).then(function (t) {
        return t.authentication.getAuthToken().then(null, function (err) {
          throw new Error('Teams sign-in failed: ' + ((err && err.message) || err));
        });
      }).then(function (token) {
        return fetch(${JSON.stringify(dataUrl)} + window.location.search, {
          headers: { Authorization: 'Bearer ' + token },
          credentials: 'omit',
          cache: 'no-store',
        });
      }).then(function (res) {
        if (!res.ok) throw new Error('Not authorised (' + res.status + ').');
        return res.text();
      }).then(function (page) {
        document.open();
        document.write(page);
        document.close();
      }).catch(function (err) {
        show((err && err.message) || String(err));
      });
    })();
  `;
}

/**
 * Fail-closed guard: the data router answers only when the kernel verified a
 * Teams SSO token and set `req.teamsSsoUser`. Protects older cores that do
 * not know `auth: 'teams-sso'`.
 */
export function requireTeamsSsoUser(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!(req as { teamsSsoUser?: unknown }).teamsSsoUser) {
    res.status(401).json({ code: 'auth.teams_sso_required' });
    return;
  }
  next();
}

export function createTeamsTabRouters(opts: TeamsTabRouterOptions): {
  shell: Router;
  data: Router;
} {
  const shell = Router();
  for (const page of opts.pages) {
    const dataUrl = opts.mountPath + opts.dataSegment + page.path;
    shell.get(
      page.path,
      renderRoute(() =>
        htmlDoc({
          title: page.title,
          body: html`
            <main class="max-w-3xl mx-auto p-6">
              <p id="omadia-status" class="text-sm text-slate-500">Loading…</p>
              <script>${safe(shellScript(dataUrl))}</script>
            </main>
          `,
        }),
      ),
    );
  }

  const data = Router();
  data.use(requireTeamsSsoUser);
  data.use(opts.dataRouter);
  return { shell, data };
}
