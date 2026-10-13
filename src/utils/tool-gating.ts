// Tool availability gating (read-only mode, SSH opt-in).
// Kept out of index.ts so it can be unit-tested without starting the server.
import { isSshEnabled } from '../resources/ssh/executor.js';

/**
 * Safety mode is an operator-controlled setting, not something the model
 * can grant itself. It is always sourced from the environment and applied
 * *after* parsing any client-supplied `configure` args, so a tool call can
 * never widen access beyond what OPNSENSE_DRY_RUN / OPNSENSE_READ_ONLY allow.
 */
export function getSafetyConfig(): { dryRun: boolean; readOnly: boolean } {
  return {
    dryRun: process.env.OPNSENSE_DRY_RUN === 'true',
    readOnly: process.env.OPNSENSE_READ_ONLY === 'true'
  };
}

/**
 * Tools that mutate router state (create/update/delete/toggle/apply/restore/
 * enable/fix-style operations), used to hide them from ListTools and hard-block
 * them in CallTool when OPNSENSE_READ_ONLY=true. Deliberately excludes
 * ssh_-prefixed and cli_-prefixed tools: those are backed by SSHExecutor/CLIExecutorResource,
 * which already gate per-command (see READ_ONLY_COMMAND_PATTERNS in
 * src/resources/ssh/executor.ts) so read-only diagnostics like
 * ssh_show_pf_rules keep working under OPNSENSE_READ_ONLY instead of being
 * blanket-blocked along with genuinely destructive commands in the same tool.
 * `configure` is also excluded — it only sets up the API connection and is
 * needed to reach a working state in the first place.
 */
export const WRITE_TOOL_NAMES = new Set<string>([
  'create_vlan', 'update_vlan', 'delete_vlan',
  'create_firewall_rule', 'create_firewall_preset', 'update_firewall_rule',
  'delete_firewall_rule', 'toggle_firewall_rule', 'toggle_firewall_rule_log',
  'restore_backup',
  'block_domain', 'unblock_domain', 'block_multiple_domains',
  'apply_blocklist_category', 'toggle_blocklist_entry',
  'add_dnsbl_subscription', 'remove_dnsbl_subscription', 'update_dnsbl_subscription',
  'haproxy_service_control',
  'monit_add_service', 'monit_update_service', 'monit_delete_service',
  'monit_add_test', 'monit_update_test', 'monit_delete_test',
  'monit_add_alert', 'monit_update_alert', 'monit_delete_alert',
  'acme_update_certificate', 'acme_renew_certificate', 'acme_sign_certificate',
  'acme_revoke_certificate', 'acme_add_action', 'acme_delete_action',
  'system_enable_intervlan_routing', 'system_update_firewall_settings',
  'interface_enable_intervlan_routing', 'interface_enable_intervlan_all',
  'interface_configure_dmz', 'interface_update_config',
  'routing_fix_all', 'routing_fix_dmz', 'routing_create_intervlan_rules',
  'haproxy_backend_create', 'haproxy_backend_delete', 'haproxy_backend_update',
  'haproxy_frontend_create', 'haproxy_frontend_delete', 'haproxy_frontend_update',
  'haproxy_certificate_create',
  'haproxy_acl_create', 'haproxy_acl_update', 'haproxy_acl_delete',
  'haproxy_action_create', 'haproxy_action_update', 'haproxy_action_delete',
  'haproxy_server_add', 'haproxy_server_update', 'haproxy_server_delete',
  'macro_play',
  'iac_apply_deployment', 'iac_destroy_deployment',
  'nat_set_mode', 'nat_create_outbound_rule', 'nat_delete_outbound_rule',
  'nat_create_port_forward', 'nat_delete_port_forward',
  'nat_fix_dmz', 'nat_quick_fix_dmz', 'nat_cleanup_dmz_fix', 'nat_apply_changes'
]);

/**
 * [hardening] Tool families that are unavailable in read-only mode on top of
 * WRITE_TOOL_NAMES. The ssh_/cli_ tools take free-form commands, so a per-command
 * read-only check is not a safe boundary for them; macro_ tools read and write
 * arbitrary local paths and replay recorded calls; `configure` can repoint the
 * client at another host with TLS verification off.
 */
const READ_ONLY_BLOCKED_PREFIXES = ['ssh_', 'cli_', 'macro_'];
const READ_ONLY_BLOCKED_NAMES = new Set<string>(['configure']);

/** Tool families that need SSH; hidden and blocked unless OPNSENSE_SSH_ENABLED=true. */
const SSH_DEPENDENT_PREFIXES = ['ssh_', 'cli_', 'nat_'];

function isBlockedInReadOnly(name: string): boolean {
  return WRITE_TOOL_NAMES.has(name)
    || READ_ONLY_BLOCKED_NAMES.has(name)
    || READ_ONLY_BLOCKED_PREFIXES.some(prefix => name.startsWith(prefix));
}

function isSshDependent(name: string): boolean {
  return SSH_DEPENDENT_PREFIXES.some(prefix => name.startsWith(prefix));
}

/**
 * Why a tool is unavailable under the current environment, or null when it may run.
 * Exported for tests.
 */
export function toolUnavailableReason(name: string): string | null {
  if (getSafetyConfig().readOnly && isBlockedInReadOnly(name)) {
    return `Tool '${name}' is unavailable: server is running in read-only mode (OPNSENSE_READ_ONLY=true).`;
  }
  if (!isSshEnabled() && isSshDependent(name)) {
    return `Tool '${name}' is unavailable: it needs SSH, which is disabled (set OPNSENSE_SSH_ENABLED=true).`;
  }
  return null;
}

