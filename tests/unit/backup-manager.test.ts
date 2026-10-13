/**
 * Unit tests for BackupManager, which is built on OPNsense's own configuration
 * history. The previous implementation listed a hard-coded fake entry and
 * restored by uploading a placeholder `<opnsense>mock config data</opnsense>`;
 * these tests pin the replacement: real history, local 0600 copies, and a
 * revert that only targets an entry the router already holds.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { mkdtempSync, rmSync, statSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { BackupManager, isValidBackupId } from '../../src/resources/backup/manager.js';

const HISTORY = {
  items: [
    { time: '1760300000.5', time_iso: '2026-10-12T20:13:20+00:00', description: 'Edited rule', username: 'root@10.0.0.2', filesize: 51234, id: 'config-1760300000.5.xml' },
    { time: '1760200000.1', time_iso: '2026-10-11T16:26:40+00:00', description: 'Boot', username: '(system)', filesize: 51000, id: 'config-1760200000.1.xml' },
  ],
};

function fakeClient() {
  return {
    get: vi.fn(),
    post: vi.fn(),
  } as any;
}

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'opnsense-backup-test-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('isValidBackupId', () => {
  it.each([
    ['config-1760300000.5.xml', true],
    ['config-1760300000.xml', true],
    ['../etc/passwd', false],
    ['config-1.xml/../../x', false],
    ['backup-2025-01-10T10-30-00-000Z', false],
  ])('%s -> %s', (id, expected) => {
    expect(isValidBackupId(id)).toBe(expected);
  });
});

describe('listBackups', () => {
  it("maps the router's history entries", async () => {
    const client = fakeClient();
    client.get.mockResolvedValue(HISTORY);
    const manager = new BackupManager(client, dir);

    const list = await manager.listBackups();

    expect(client.get).toHaveBeenCalledWith('/core/backup/backups/this');
    expect(list.map(b => b.id)).toEqual(['config-1760300000.5.xml', 'config-1760200000.1.xml']);
    expect(list[0].size).toBe(51234);
    expect(list[0].timestamp.toISOString()).toBe('2026-10-12T20:13:20.000Z');
  });
});

describe('createBackup', () => {
  it('saves the downloaded config.xml locally with mode 0600 and returns no content', async () => {
    const client = fakeClient();
    client.get.mockResolvedValue('<?xml version="1.0"?>\n<opnsense><system/></opnsense>');
    const manager = new BackupManager(client, dir);

    const result = await manager.createBackup({ description: 'Before VLAN change' });

    expect(client.get).toHaveBeenCalledWith('/core/backup/download/this');
    expect(result.file.startsWith(dir)).toBe(true);
    expect(result.file).toMatch(/before-vlan-change\.xml$/);
    expect(await fs.readFile(result.file, 'utf-8')).toContain('<opnsense>');
    expect(statSync(result.file).mode & 0o777).toBe(0o600);
    expect(result).not.toHaveProperty('content');
  });

  it('refuses to save something that is not a config.xml', async () => {
    const client = fakeClient();
    client.get.mockResolvedValue('<html>login</html>');
    const manager = new BackupManager(client, dir);

    await expect(manager.createBackup()).rejects.toThrow(/not an OPNsense config/);
  });
});

describe('restoreBackup', () => {
  it('reverts to an existing history entry via revertBackup, uploading nothing', async () => {
    const client = fakeClient();
    client.get.mockResolvedValue(HISTORY);
    client.post.mockResolvedValue({ status: 'reverted' });
    const manager = new BackupManager(client, dir);

    await expect(manager.restoreBackup('config-1760200000.1.xml')).resolves.toBe(true);

    expect(client.post).toHaveBeenCalledTimes(1);
    expect(client.post).toHaveBeenCalledWith('/core/backup/revertBackup/config-1760200000.1.xml');
  });

  it('rejects an id that is not in the history without sending anything', async () => {
    const client = fakeClient();
    client.get.mockResolvedValue(HISTORY);
    const manager = new BackupManager(client, dir);

    await expect(manager.restoreBackup('config-1.xml')).rejects.toThrow(/not found/);
    expect(client.post).not.toHaveBeenCalled();
  });

  it('rejects a malformed id before calling the router', async () => {
    const client = fakeClient();
    const manager = new BackupManager(client, dir);

    await expect(manager.restoreBackup('../../conf/config.xml')).rejects.toThrow(/Invalid backup id/);
    expect(client.get).not.toHaveBeenCalled();
    expect(client.post).not.toHaveBeenCalled();
  });

  it('throws when the router does not confirm the revert', async () => {
    const client = fakeClient();
    client.get.mockResolvedValue(HISTORY);
    client.post.mockResolvedValue({ status: 'not_found' });
    const manager = new BackupManager(client, dir);

    await expect(manager.restoreBackup('config-1760200000.1.xml')).rejects.toThrow(/Revert failed/);
  });
});

describe('diffBackups', () => {
  it('asks the router for the newer-vs-older diff', async () => {
    const client = fakeClient();
    client.get.mockResolvedValue({ items: ['--- a', '+++ b'] });
    const manager = new BackupManager(client, dir);

    const lines = await manager.diffBackups('config-1760200000.1.xml', 'config-1760300000.5.xml');

    expect(client.get).toHaveBeenCalledWith('/core/backup/diff/this/config-1760300000.5.xml/config-1760200000.1.xml');
    expect(lines).toEqual(['--- a', '+++ b']);
  });
});
