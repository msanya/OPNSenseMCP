/**
 * DHCP leases come from three possible backends (Kea, dnsmasq, legacy ISC).
 * Measured on a live OPNsense 25.x: ISC answered with 0 rows while Kea held the
 * current leases and an old dnsmasq lease file was still served — so the
 * resource must read all of them and keep the freshest lease per MAC.
 */
import { describe, it, expect, vi } from 'vitest';
import { DhcpLeaseResource } from '../../src/resources/services/dhcp/leases.js';

function clientWith(responses: Record<string, any>) {
  return {
    post: vi.fn(async (path: string) => {
      const r = responses[path];
      if (r instanceof Error) throw r;
      return r ?? { rows: [] };
    }),
    get: vi.fn(),
  } as any;
}

describe('DhcpLeaseResource.listLeases', () => {
  it('merges Kea, dnsmasq and ISC leases, keeping the lease that expires last per MAC', async () => {
    const client = clientWith({
      '/kea/leases4/search': { rows: [
        { address: '192.168.31.51', hwaddr: 'EC:75:0C:46:D2:DB', hostname: 'switch', expire: '1791892768', if_descr: 'LAN', mac_info: 'TP-Link' },
      ] },
      '/dnsmasq/leases/search': { rows: [
        { address: '192.168.31.99', hwaddr: 'ec:75:0c:46:d2:db', hostname: 'switch-old', expire: 1767355419, if_descr: 'LAN' },
        { address: '192.168.31.42', hwaddr: '34:ab:95:16:04:c7', hostname: 'ESP_1604C7', expire: 1767355419, if_descr: 'LAN', mac_info: 'Espressif Inc.' },
      ] },
      '/dhcpv4/leases/searchLease': { rows: [] },
    });

    const leases = await new DhcpLeaseResource(client).listLeases();

    expect(leases).toHaveLength(2);
    const sw = leases.find(l => l.hwaddr.toLowerCase() === 'ec:75:0c:46:d2:db')!;
    expect(sw.address).toBe('192.168.31.51');
    expect(sw.source).toBe('kea');
    expect(sw.if).toBe('LAN');
    expect(sw.man).toBe('TP-Link');
    expect(sw.ends).toBe(new Date(1791892768 * 1000).toISOString());
    expect(leases.find(l => l.hostname === 'ESP_1604C7')!.source).toBe('dnsmasq');
  });

  it('skips a backend that errors and still returns the others', async () => {
    const client = clientWith({
      '/kea/leases4/search': new Error('404'),
      '/dnsmasq/leases/search': new Error('404'),
      '/dhcpv4/leases/searchLease': { rows: [{ address: '10.0.0.5', hwaddr: 'aa:bb:cc:dd:ee:ff', hostname: 'pc' }] },
    });

    const leases = await new DhcpLeaseResource(client).listLeases();

    expect(leases.map(l => [l.address, l.source])).toEqual([['10.0.0.5', 'isc']]);
  });

  it('returns an empty list when no backend answers', async () => {
    const client = clientWith({
      '/kea/leases4/search': new Error('x'),
      '/dnsmasq/leases/search': new Error('x'),
      '/dhcpv4/leases/searchLease': new Error('x'),
    });

    await expect(new DhcpLeaseResource(client).listLeases()).resolves.toEqual([]);
  });
});
