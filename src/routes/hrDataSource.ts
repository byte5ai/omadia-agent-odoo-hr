/**
 * HR data source — Odoo HR-module reads via the shared `odoo.client`
 * service (published by @omadia/integration-odoo). Returns the same
 * shape the templates render so the route handlers don't care whether
 * the data is real or mocked.
 *
 * Errors are caught by the route handler — a transient Odoo outage
 * surfaces as a "(Odoo nicht erreichbar)" banner instead of breaking
 * the Tab.
 */

export interface Birthday {
  readonly name: string;
  readonly department: string;
  /** ISO date `YYYY-MM-DD` — Odoo's stored format. */
  readonly dateOfBirth: string;
}

export interface Absence {
  readonly name: string;
  readonly department: string;
  readonly type: 'vacation' | 'sick' | 'training' | 'parental' | 'remote';
  /** ISO date `YYYY-MM-DD` inclusive. */
  readonly fromDate: string;
  /** ISO date `YYYY-MM-DD` inclusive. */
  readonly toDate: string;
  readonly substitute?: string;
}

/**
 * Minimal Odoo executor contract. Matches the `execute(req)` signature
 * the integration-odoo plugin's `OdooClient` exposes. Declaring it
 * locally avoids a hard TypeScript dependency on @omadia/integration-
 * odoo — the runtime dependency is already declared in manifest.yaml's
 * depends_on chain.
 */
export interface OdooExecutor {
  execute(req: {
    model: string;
    method: string;
    positionalArgs: unknown[];
    kwargs: Record<string, unknown>;
  }): Promise<unknown>;
}

/* ---------- Birthdays ----------------------------------------------- */

interface OdooEmployeeRow {
  id: number;
  name: string;
  birthday: string | false;
  department_id: [number, string] | false;
}

export async function fetchBirthdays(
  client: OdooExecutor,
): Promise<readonly Birthday[]> {
  // Pull active employees with a stored birthday. Odoo can't filter "in
  // the next 30 days" server-side because the year embedded in `birthday`
  // is the birth year — we filter client-side after re-projecting day
  // and month against the current year.
  const raw = (await client.execute({
    model: 'hr.employee',
    method: 'search_read',
    positionalArgs: [
      [
        ['active', '=', true],
        ['birthday', '!=', false],
      ],
    ],
    kwargs: {
      fields: ['id', 'name', 'birthday', 'department_id'],
      limit: 500,
      order: 'name asc',
    },
  })) as OdooEmployeeRow[];

  return raw.map(
    (r): Birthday => ({
      name: r.name,
      department: Array.isArray(r.department_id)
        ? (r.department_id[1] ?? '—')
        : '—',
      dateOfBirth: typeof r.birthday === 'string' ? r.birthday : '',
    }),
  ).filter((b) => b.dateOfBirth.length > 0);
}

/* ---------- Absences ------------------------------------------------ */

interface OdooLeaveRow {
  id: number;
  employee_id: [number, string] | false;
  holiday_status_id: [number, string] | false;
  date_from: string | false;
  date_to: string | false;
  state: string;
  department_id?: [number, string] | false;
}

export async function fetchAbsences(
  client: OdooExecutor,
): Promise<readonly Absence[]> {
  // Surface validated leaves that overlap a 30-day window centred on
  // today. The Tab template later splits them into "today" vs "upcoming".
  const today = new Date().toISOString().slice(0, 10);
  const horizon = (() => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + 60);
    return d.toISOString().slice(0, 10);
  })();
  const raw = (await client.execute({
    model: 'hr.leave',
    method: 'search_read',
    positionalArgs: [
      [
        ['state', 'in', ['validate', 'validate1']],
        ['date_to', '>=', today],
        ['date_from', '<=', horizon],
      ],
    ],
    kwargs: {
      fields: [
        'id',
        'employee_id',
        'holiday_status_id',
        'date_from',
        'date_to',
        'state',
        'department_id',
      ],
      limit: 200,
      order: 'date_from asc',
    },
  })) as OdooLeaveRow[];

  return raw
    .map((r): Absence | null => {
      if (!Array.isArray(r.employee_id)) return null;
      if (typeof r.date_from !== 'string' || typeof r.date_to !== 'string') {
        return null;
      }
      const typeName = Array.isArray(r.holiday_status_id)
        ? (r.holiday_status_id[1] ?? '')
        : '';
      return {
        name: r.employee_id[1] ?? '—',
        department: Array.isArray(r.department_id)
          ? (r.department_id[1] ?? '—')
          : '—',
        type: mapLeaveType(typeName),
        // Odoo returns datetime ('YYYY-MM-DD HH:MM:SS') — strip the time
        // since the Tab template renders date-only.
        fromDate: r.date_from.slice(0, 10),
        toDate: r.date_to.slice(0, 10),
      };
    })
    .filter((a): a is Absence => a !== null);
}

function mapLeaveType(odooTypeName: string): Absence['type'] {
  const n = odooTypeName.toLowerCase();
  if (n.includes('krank') || n.includes('sick')) return 'sick';
  if (n.includes('schul') || n.includes('train') || n.includes('weiterbild'))
    return 'training';
  if (n.includes('eltern') || n.includes('parent') || n.includes('mutter'))
    return 'parental';
  if (n.includes('home') || n.includes('remote') || n.includes('mobile'))
    return 'remote';
  return 'vacation';
}

/* ---------- Helpers shared by the route templates ------------------- */

export function isToday(dateOfBirth: string, now: Date = new Date()): boolean {
  const [, m, d] = dateOfBirth.split('-');
  const todayM = String(now.getUTCMonth() + 1).padStart(2, '0');
  const todayD = String(now.getUTCDate()).padStart(2, '0');
  return m === todayM && d === todayD;
}

export function daysUntilBirthday(
  dateOfBirth: string,
  now: Date = new Date(),
): number {
  const [, m, d] = dateOfBirth.split('-');
  if (!m || !d) return Number.POSITIVE_INFINITY;
  const year = now.getUTCFullYear();
  const candidate = new Date(Date.UTC(year, Number(m) - 1, Number(d)));
  if (candidate.getTime() < now.getTime() - 24 * 3600 * 1000) {
    candidate.setUTCFullYear(year + 1);
  }
  const ms = candidate.getTime() - now.getTime();
  return Math.max(0, Math.ceil(ms / (24 * 3600 * 1000)));
}

export function isAbsentToday(
  absence: Absence,
  now: Date = new Date(),
): boolean {
  const todayIso = now.toISOString().slice(0, 10);
  return absence.fromDate <= todayIso && todayIso <= absence.toDate;
}

export function formatGermanDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${d}.${m}.${y}`;
}

export function formatGermanDayMonth(iso: string): string {
  const [, m, d] = iso.split('-');
  if (!m || !d) return iso;
  return `${d}.${m}.`;
}

export function absenceTypeLabel(type: Absence['type']): string {
  switch (type) {
    case 'vacation':
      return 'Urlaub';
    case 'sick':
      return 'Krank';
    case 'training':
      return 'Fortbildung';
    case 'parental':
      return 'Elternzeit';
    case 'remote':
      return 'Remote';
  }
}

export function absenceTypeBadgeClasses(type: Absence['type']): string {
  switch (type) {
    case 'vacation':
      return 'bg-emerald-100 text-emerald-700';
    case 'sick':
      return 'bg-rose-100 text-rose-700';
    case 'training':
      return 'bg-indigo-100 text-indigo-700';
    case 'parental':
      return 'bg-violet-100 text-violet-700';
    case 'remote':
      return 'bg-sky-100 text-sky-700';
  }
}
