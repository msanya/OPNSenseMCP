// OPNsense Backup Manager
//
// Built on OPNsense's own configuration history (/conf/backup/config-*.xml),
// exposed by the core backup API (Core/Api/BackupController):
//   GET  /core/backup/backups/this               list history entries
//   GET  /core/backup/download/this[/<id>]       download a config.xml
//   GET  /core/backup/diff/this/<id1>/<id2>      unified diff of two entries
//   POST /core/backup/revertBackup/<id>          revert to a history entry
// OPNsense writes a history entry on every configuration save, so a restore
// point always exists on the router itself. Restores never upload a file from
// this machine: they revert to an entry the router already holds.
import { promises as fs } from 'fs';
import { join, resolve } from 'path';
import { OPNSenseAPIClient } from '../../api/client.js';
import { logger } from '../../utils/logger.js';

export interface BackupInfo {
  id: string;
  timestamp: Date;
  size?: number;
  description?: string;
  username?: string;
}

export interface LocalBackupInfo {
  file: string;
  size: number;
  timestamp: Date;
}

export interface BackupOptions {
  description?: string;
}

/** History entry ids look like `config-1760000000.1234.xml`. */
const BACKUP_ID_PATTERN = /^config-[0-9]+(\.[0-9]+)?\.xml$/;

export function isValidBackupId(id: string): boolean {
  return BACKUP_ID_PATTERN.test(id);
}

export class BackupManager {
  private client: OPNSenseAPIClient;
  private backupPath: string;

  constructor(client: OPNSenseAPIClient, backupPath: string = './backups') {
    this.client = client;
    this.backupPath = backupPath;
  }

  /**
   * List the router's configuration history, newest first.
   */
  async listBackups(): Promise<BackupInfo[]> {
    const response = await this.client.get('/core/backup/backups/this');
    const items: any[] = Array.isArray(response?.items) ? response.items : [];
    return items.map(item => ({
      id: String(item.id),
      timestamp: new Date(item.time_iso ?? Number(item.time) * 1000),
      size: item.filesize !== undefined ? Number(item.filesize) : undefined,
      description: item.description,
      username: item.username
    }));
  }

  /**
   * Download the current configuration and keep a local copy under the
   * backup path (mode 0600 — config.xml carries password hashes and keys).
   * The file content is never returned to the caller.
   */
  async createBackup(options: BackupOptions = {}): Promise<LocalBackupInfo> {
    const config = await this.downloadConfig();
    if (typeof config !== 'string' || !config.includes('<opnsense')) {
      throw new Error('Downloaded configuration is not an OPNsense config.xml');
    }

    const timestamp = new Date();
    const slug = (options.description ?? '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40);
    const name = `opnsense-config-${timestamp.toISOString().replace(/[:.]/g, '-')}${slug ? `-${slug}` : ''}.xml`;

    const dir = resolve(this.backupPath);
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    const file = join(dir, name);
    await fs.writeFile(file, config, { mode: 0o600 });
    logger.info(`[Backup] Saved configuration copy to ${file} (${config.length} bytes)`);

    return { file, size: config.length, timestamp };
  }

  /**
   * Download a configuration file from the router's history.
   * Without an id the latest entry is returned.
   */
  async downloadConfig(backupId?: string): Promise<string> {
    if (backupId !== undefined && !isValidBackupId(backupId)) {
      throw new Error(`Invalid backup id: ${backupId}`);
    }
    const path = backupId
      ? `/core/backup/download/this/${backupId}`
      : '/core/backup/download/this';
    return this.client.get(path);
  }

  /**
   * Unified diff between two history entries (older first, newer second).
   */
  async diffBackups(olderId: string, newerId: string): Promise<string[]> {
    for (const id of [olderId, newerId]) {
      if (!isValidBackupId(id)) {
        throw new Error(`Invalid backup id: ${id}`);
      }
    }
    const response = await this.client.get(`/core/backup/diff/this/${newerId}/${olderId}`);
    return Array.isArray(response?.items) ? response.items : [];
  }

  /**
   * Revert the running configuration to a history entry held on the router.
   */
  async restoreBackup(backupId: string): Promise<boolean> {
    if (!isValidBackupId(backupId)) {
      throw new Error(`Invalid backup id: ${backupId} (expected config-<timestamp>.xml from list_backups)`);
    }

    const backups = await this.listBackups();
    if (!backups.some(b => b.id === backupId)) {
      throw new Error(`Backup ${backupId} not found in the router's configuration history`);
    }

    const response = await this.client.post(`/core/backup/revertBackup/${backupId}`);
    if (response?.status === 'reverted') {
      logger.info(`[Backup] Reverted configuration to ${backupId}`);
      return true;
    }
    if (response?.dryRun) {
      return false;
    }
    throw new Error(`Revert failed: ${JSON.stringify(response)}`);
  }
}
