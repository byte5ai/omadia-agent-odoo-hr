/**
 * Instance-unique tool names. The toolkit of `@omadia/integration-odoo` calls
 * its tools `query_graph` and `odoo_execute` in every scope; the accounting
 * plugin registers the same two, so each scope gets its own prefix.
 */
export const HR_TOOL_NAMES = {
  graph: 'odoo_hr_query_graph',
  execute: 'odoo_hr_execute',
} as const;

export const HR_TOOL_RENAME: Readonly<Record<string, string>> = {
  query_graph: HR_TOOL_NAMES.graph,
  odoo_execute: HR_TOOL_NAMES.execute,
};

/**
 * Tool knowledge that used to live in the playbook and runtime-note skills
 * (prompt_partial), now appended to the tool descriptions the calling agent
 * sees (spec 2042 §5.10). Persona and tone ship as agent templates instead.
 */
export const HR_TOOL_DOCS: Readonly<Record<string, string>> = {
  [HR_TOOL_NAMES.graph]: [
    'The graph is synced from Odoo every 6 h and answers in under 10 ms: ask it FIRST for stable master data (who is in department Y, which departments exist, employees named X). It holds only hr.employee and hr.department.',
    `If it finds nothing, or the question is about numbers, status or time, use \`${HR_TOOL_NAMES.execute}\`.`,
  ].join('\n'),
  [HR_TOOL_NAMES.execute]: [
    'Use it for everything transactional: leave (hr.leave), allocations, attendance, contracts (structure only), recruiting (hr.applicant), current status fields, date ranges, and whenever the graph has no hit.',
    'Hard red lines (enforced server-side: requests are rejected with 403 `hr_red_line_field`, responses are stripped): wages and payroll (`wage`, `hourly_wage`, `struct_id`, every hr.payslip model); tax and social-security ids (`ssnid`, `sinid`, `identification_id`, `passport_id`, `permit_no`); bank accounts (`bank_account_id`); private address and contact data (`private_*`); emergency contacts; dotted sub-selectors such as `contract_id.wage`. Do not request them. If asked, say: "I never give this field out for security reasons; please look it up in Odoo through authorised HR or management."',
    'Allowed models (others answer 403 `model_not_allowed`): hr.employee, hr.employee.public (reduced view; use it when only name, title, department are needed), hr.department, hr.job, hr.contract (structure, no wages), hr.leave, hr.leave.allocation, hr.leave.type, hr.attendance, hr.applicant, resource.calendar, resource.calendar.leaves, resource.calendar.attendance, hr.work.location.',
    'Key fields: hr.employee name, active, job_title, job_id, department_id, parent_id (manager), coach_id, work_email, work_phone, work_location_id, company_id, employee_type, user_id, birthday. hr.department name, complete_name, manager_id, parent_id, total_employee. hr.job name, department_id, no_of_recruitment, expected_employees, state (open/close). hr.contract employee_id, department_id, job_id, date_start, date_end, state (draft/open/close/cancel). hr.leave employee_id, holiday_status_id, date_from, date_to, number_of_days, state (draft/confirm/validate/refuse; taken leave is mostly `validate`, planned `confirm`), private_name (free text, shorten when too detailed). hr.leave.allocation employee_id, holiday_status_id, number_of_days, state. hr.attendance employee_id, check_in, check_out, worked_hours. hr.applicant partner_name, job_id, stage_id, kanban_state. resource.calendar name, hours_per_day, tz.',
    'Recipes: headcount per department = read_group on hr.employee `[[["active","=",true]],["id:count"],["department_id"]]`; absent today = search_count on hr.leave with state validate and date_from <= today <= date_to; leave balance = read_group on hr.leave.allocation (`number_of_days:sum` by holiday_status_id, state validate) minus taken days from hr.leave; open positions = search_read on hr.job with state open; reporting chain = read `parent_id` and follow it until it is empty or loops.',
    'Rules: aggregate first (search_count / read_group, not search_read over the whole staff); default to active=true and include former employees only on request; resolve relative dates ("today", "last month") to ISO dates and state them in the answer; with several companies clarify which one is meant before aggregating; do not show database ids unless asked; show names, not [id, name] pairs. Errors: 413 means narrow `fields` or `limit`; 502 carries the Odoo failure, report it verbatim and retry at most once.',
  ].join('\n'),
};
