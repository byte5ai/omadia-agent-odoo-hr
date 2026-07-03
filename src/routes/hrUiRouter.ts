import { Router } from 'express';
import { html, htmlDoc, renderRoute, safe } from '@omadia/plugin-ui-helpers';
import type { HtmlFragment } from '@omadia/plugin-ui-helpers';

import {
  absenceTypeBadgeClasses,
  absenceTypeLabel,
  daysUntilBirthday,
  fetchAbsences,
  fetchBirthdays,
  formatGermanDate,
  formatGermanDayMonth,
  isAbsentToday,
  isToday,
  type Absence,
  type Birthday,
  type OdooExecutor,
} from './hrDataSource.js';

export interface HrUiRouterOptions {
  /** Shared OdooClient (the integration-odoo plugin's `odoo.client`
   *  service). Required — the plugin's activate() refuses to mount
   *  these routes without it. */
  readonly odooClient: OdooExecutor;
  /** Optional logger — defaults to console.log. */
  readonly log?: (...args: unknown[]) => void;
}

/**
 * Plugin-served HR dashboards. Mount under `/p/agent-odoo-hr` via
 * ctx.routes.register; the operator pins them as Teams Tabs (or opens
 * them in a browser, same URL).
 *
 * Each route SSR-fetches its data from Odoo HR on every request. With
 * `refreshSeconds: 60` the Tab self-fills — a vacation entered in
 * Odoo surfaces in the Tab within a minute, with zero client-side JS.
 *
 * Errors during the Odoo fetch render an inline banner instead of a
 * crashed 500 — the Tab degrades gracefully when the integration is
 * misconfigured or Odoo is reachable-but-slow.
 */
export function createHrUiRouter(opts: HrUiRouterOptions): Router {
  const router = Router();
  const log = opts.log ?? ((m: unknown) => console.log(m));

  router.get(
    '/birthdays',
    renderRoute(async () => {
      let items: readonly Birthday[] = [];
      let fetchError: string | null = null;
      try {
        items = await fetchBirthdays(opts.odooClient);
      } catch (err) {
        fetchError = err instanceof Error ? err.message : String(err);
        log('[agent-odoo-hr] birthdays fetch failed:', fetchError);
      }
      const now = new Date();
      const today = items.filter((b) => isToday(b.dateOfBirth, now));
      const upcoming = [...items]
        .filter((b) => !isToday(b.dateOfBirth, now))
        .map((b) => ({ ...b, in: daysUntilBirthday(b.dateOfBirth, now) }))
        .sort((a, b) => a.in - b.in)
        .slice(0, 10);

      return htmlDoc({
        title: 'HR — Geburtstage',
        refreshSeconds: 60,
        body: html`
          <main class="max-w-2xl mx-auto p-6 space-y-6">
            <header>
              <h1 class="text-2xl font-semibold tracking-tight">Geburtstage</h1>
              <p class="text-sm text-slate-500">
                Heute &amp; nächste 4 Wochen. Aktualisiert sich alle 60 s
                aus Odoo HR.
              </p>
            </header>

            ${fetchError ? errorBanner(fetchError) : ''}

            <section>
              <h2 class="text-sm uppercase tracking-wider text-slate-500 mb-2">
                Heute
              </h2>
              ${today.length === 0
                ? safe(
                    '<p class="text-sm text-slate-400 italic">Heute hat niemand Geburtstag.</p>',
                  )
                : html`
                    <ul class="space-y-2">
                      ${today.map(
                        (b) => html`
                          <li
                            class="flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4"
                          >
                            <div>
                              <div class="text-base font-medium text-amber-900">
                                🎉 ${b.name}
                              </div>
                              <div class="text-xs text-amber-700/80 mt-0.5">
                                ${b.department}
                              </div>
                            </div>
                            <div class="text-xs uppercase tracking-wider text-amber-700">
                              heute
                            </div>
                          </li>
                        `,
                      )}
                    </ul>
                  `}
            </section>

            <section>
              <h2 class="text-sm uppercase tracking-wider text-slate-500 mb-2">
                Demnächst
              </h2>
              ${upcoming.length === 0
                ? safe(
                    '<p class="text-sm text-slate-400 italic">Keine Geburtstage in den nächsten Wochen.</p>',
                  )
                : html`
                    <ul class="space-y-2">
                      ${upcoming.map(
                        (b) => html`
                          <li
                            class="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-3"
                          >
                            <div>
                              <div class="text-sm font-medium text-slate-900">
                                ${b.name}
                              </div>
                              <div class="text-xs text-slate-500 mt-0.5">
                                ${b.department}
                              </div>
                            </div>
                            <div class="text-right">
                              <div class="text-sm font-mono text-slate-700">
                                ${formatGermanDayMonth(b.dateOfBirth)}
                              </div>
                              <div class="text-[10px] uppercase tracking-wider text-slate-400 mt-0.5">
                                in ${b.in === 1 ? '1 Tag' : `${b.in} Tagen`}
                              </div>
                            </div>
                          </li>
                        `,
                      )}
                    </ul>
                  `}
            </section>

            <footer class="text-[10px] uppercase tracking-wider text-slate-400 pt-4 border-t border-slate-200">
              Quelle: Odoo HR · hr.employee · ${new Date().toISOString().slice(11, 19)} UTC
            </footer>
          </main>
        `,
      });
    }),
  );

  router.get(
    '/absences',
    renderRoute(async () => {
      let items: readonly Absence[] = [];
      let fetchError: string | null = null;
      try {
        items = await fetchAbsences(opts.odooClient);
      } catch (err) {
        fetchError = err instanceof Error ? err.message : String(err);
        log('[agent-odoo-hr] absences fetch failed:', fetchError);
      }
      const now = new Date();
      const todayIso = now.toISOString().slice(0, 10);
      const todayList = items.filter((a) => isAbsentToday(a, now));
      const upcoming = items
        .filter((a) => !isAbsentToday(a, now) && a.fromDate > todayIso)
        .sort((a, b) => a.fromDate.localeCompare(b.fromDate))
        .slice(0, 10);

      return htmlDoc({
        title: 'HR — Abwesenheiten',
        refreshSeconds: 60,
        body: html`
          <main class="max-w-2xl mx-auto p-6 space-y-6">
            <header>
              <h1 class="text-2xl font-semibold tracking-tight">
                Abwesenheiten
              </h1>
              <p class="text-sm text-slate-500">
                Wer ist heute weg, wer kommt als Nächstes. Aktualisiert sich
                alle 60 s aus Odoo HR.
              </p>
            </header>

            ${fetchError ? errorBanner(fetchError) : ''}

            <section>
              <h2 class="text-sm uppercase tracking-wider text-slate-500 mb-2">
                Heute weg (${todayList.length})
              </h2>
              ${todayList.length === 0
                ? safe(
                    '<p class="text-sm text-slate-400 italic">Niemand ist heute abwesend.</p>',
                  )
                : html`
                    <ul class="space-y-2">
                      ${todayList.map(
                        (a) => html`
                          <li
                            class="flex items-start justify-between gap-3 rounded-lg border border-slate-200 bg-white p-4"
                          >
                            <div>
                              <div class="text-base font-medium text-slate-900">
                                ${a.name}
                              </div>
                              <div class="text-xs text-slate-500 mt-0.5">
                                ${a.department}
                              </div>
                              ${a.substitute
                                ? html`
                                    <div
                                      class="text-xs text-slate-600 mt-2"
                                    >
                                      Vertretung:
                                      <span class="font-medium">${a.substitute}</span>
                                    </div>
                                  `
                                : ''}
                            </div>
                            <div class="text-right shrink-0">
                              <span
                                class="inline-block text-[10px] uppercase tracking-wider rounded px-2 py-0.5 ${absenceTypeBadgeClasses(
                                  a.type,
                                )}"
                              >
                                ${absenceTypeLabel(a.type)}
                              </span>
                              <div
                                class="text-xs font-mono text-slate-500 mt-2"
                              >
                                bis ${formatGermanDate(a.toDate)}
                              </div>
                            </div>
                          </li>
                        `,
                      )}
                    </ul>
                  `}
            </section>

            <section>
              <h2 class="text-sm uppercase tracking-wider text-slate-500 mb-2">
                Demnächst (${upcoming.length})
              </h2>
              ${upcoming.length === 0
                ? safe(
                    '<p class="text-sm text-slate-400 italic">Keine geplanten Abwesenheiten.</p>',
                  )
                : html`
                    <ul class="space-y-2">
                      ${upcoming.map(
                        (a) => html`
                          <li
                            class="flex items-start justify-between gap-3 rounded-lg border border-slate-200 bg-white p-3"
                          >
                            <div>
                              <div class="text-sm font-medium text-slate-900">
                                ${a.name}
                              </div>
                              <div class="text-xs text-slate-500 mt-0.5">
                                ${a.department}
                              </div>
                            </div>
                            <div class="text-right">
                              <span
                                class="inline-block text-[10px] uppercase tracking-wider rounded px-2 py-0.5 ${absenceTypeBadgeClasses(
                                  a.type,
                                )}"
                              >
                                ${absenceTypeLabel(a.type)}
                              </span>
                              <div
                                class="text-xs font-mono text-slate-500 mt-2"
                              >
                                ${formatGermanDate(a.fromDate)} –
                                ${formatGermanDate(a.toDate)}
                              </div>
                            </div>
                          </li>
                        `,
                      )}
                    </ul>
                  `}
            </section>

            <footer class="text-[10px] uppercase tracking-wider text-slate-400 pt-4 border-t border-slate-200">
              Quelle: Odoo HR · hr.leave · ${new Date().toISOString().slice(11, 19)} UTC
            </footer>
          </main>
        `,
      });
    }),
  );

  return router;
}

function errorBanner(message: string): HtmlFragment {
  return html`
    <div
      class="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-800"
    >
      <strong class="block text-sm font-semibold mb-1">
        Odoo HR konnte nicht gelesen werden
      </strong>
      <code class="block break-all text-rose-900/80">${message}</code>
      <p class="mt-2 text-rose-700/80">
        Das Tab versucht die Abfrage in 60 s erneut.
      </p>
    </div>
  `;
}
