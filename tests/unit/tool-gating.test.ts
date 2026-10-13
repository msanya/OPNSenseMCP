/**
 * Unit tests for tool availability gating: read-only mode and SSH opt-in.
 *
 * In read-only mode the free-form command tools (ssh_*, cli_*), the macro
 * tools and `configure` must be unavailable, not only the WRITE_TOOL_NAMES
 * set: a per-command read-only check is not a safe boundary for them.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.resetModules();
  process.env = { ...ORIGINAL_ENV };
  delete process.env.OPNSENSE_READ_ONLY;
  delete process.env.OPNSENSE_SSH_ENABLED;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

async function load() {
  return import('../../src/utils/tool-gating.js');
}

describe('read-only mode', () => {
  beforeEach(() => {
    process.env.OPNSENSE_READ_ONLY = 'true';
    process.env.OPNSENSE_SSH_ENABLED = 'true';
  });

  it.each([
    'ssh_execute', 'ssh_batch_execute', 'ssh_show_pf_rules', 'ssh_restore_config',
    'cli_execute', 'cli_show_routing',
    'macro_export', 'macro_import', 'macro_play', 'macro_list',
    'configure',
    'restore_backup', 'delete_firewall_rule', 'nat_set_mode',
  ])('blocks %s', async (name) => {
    const { toolUnavailableReason } = await load();
    expect(toolUnavailableReason(name)).toMatch(/read-only mode/);
  });

  it.each([
    'list_firewall_rules', 'list_backups', 'diff_backups', 'create_backup',
    'list_dhcp_leases', 'list_arp_entries', 'get_interfaces', 'test_connection',
  ])('keeps the read tool %s available', async (name) => {
    const { toolUnavailableReason } = await load();
    expect(toolUnavailableReason(name)).toBeNull();
  });
});

describe('SSH opt-in', () => {
  it.each(['ssh_execute', 'ssh_show_routing', 'cli_execute', 'nat_list_outbound', 'nat_get_mode'])(
    'hides %s when OPNSENSE_SSH_ENABLED is not set', async (name) => {
      const { toolUnavailableReason } = await load();
      expect(toolUnavailableReason(name)).toMatch(/SSH, which is disabled/);
    });

  it('allows SSH tools when SSH is enabled and the server is not read-only', async () => {
    process.env.OPNSENSE_SSH_ENABLED = 'true';
    const { toolUnavailableReason } = await load();
    expect(toolUnavailableReason('ssh_execute')).toBeNull();
    expect(toolUnavailableReason('nat_list_outbound')).toBeNull();
  });

  it('does not affect API tools', async () => {
    const { toolUnavailableReason } = await load();
    expect(toolUnavailableReason('list_firewall_rules')).toBeNull();
    expect(toolUnavailableReason('create_firewall_rule')).toBeNull();
  });
});
