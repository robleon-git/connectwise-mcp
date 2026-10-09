// Operator/test reference only. This does not register or execute application tools.
export const EXPECTED_READ_TOOLS = Object.freeze([
  "cw_search_tickets", "cw_get_ticket", "cw_get_ticket_notes",
  "cw_search_companies", "cw_get_company", "cw_search_contacts", "cw_get_contact",
  "cw_search_projects", "cw_get_project", "cw_search_project_tickets", "cw_get_project_ticket", "cw_get_project_ticket_notes",
  "cw_search_time_entries", "cw_get_time_entry", "cw_search_members", "cw_get_member",
  "cw_search_configurations", "cw_get_configuration", "cw_list_boards", "cw_list_priorities", "cw_list_statuses",
  "cw_search_activities", "cw_get_activity", "cw_search_catalog_items", "cw_get_catalog_item",
  "cw_list_catalog_categories", "cw_list_catalog_subcategories", "cw_list_manufacturers", "cw_test_connection",
  "cw_search_agreements", "cw_get_agreement", "cw_get_agreement_additions", "cw_search_invoices", "cw_get_invoice",
  "cw_search_opportunities", "cw_get_opportunity", "cw_search_opportunity_forecasts", "cw_search_opportunity_notes", "cw_search_sales_stages",
]);

export function matchesReadToolInventory(names) {
  return Array.isArray(names) && names.length === EXPECTED_READ_TOOLS.length &&
    new Set(names).size === names.length && EXPECTED_READ_TOOLS.every(name => names.includes(name));
}
