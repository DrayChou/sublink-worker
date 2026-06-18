import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app/createApp.jsx';
import { MemoryKVAdapter } from '../src/adapters/kv/memoryKv.js';

const SS_AUTH = 'YWVzLTEyOC1nY206cGFzcw';
const JP_URL = `ss://${SS_AUTH}@jp.example.com:443#日本-01`;
const HK_URL = `ss://${SS_AUTH}@hk.example.com:443#香港-01`;
const US_URL = `ss://${SS_AUTH}@us.example.com:443#美国-01`;
const INPUT = [JP_URL, HK_URL, US_URL].join('\n');

function createTestApp(overrides = {}) {
    return createApp({
        kv: overrides.kv ?? new MemoryKVAdapter(),
        assetFetcher: overrides.assetFetcher ?? null,
        subscriptionCache: overrides.subscriptionCache ?? null,
        logger: console,
        config: {
            configTtlSeconds: 60,
            shortLinkTtlSeconds: null,
            ...(overrides.config || {})
        }
    });
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('Node title filter', () => {
    it('includes only matching nodes for singbox keyword filters', async () => {
        const app = createTestApp();
        const values = JSON.stringify(['日本', '美国']);
        const res = await app.request(
            `http://localhost/singbox?config=${encodeURIComponent(INPUT)}&node_filter_mode=include&node_filter_type=keyword&node_filter_values=${encodeURIComponent(values)}`
        );

        expect(res.status).toBe(200);
        const json = await res.json();
        const tags = json.outbounds.filter(outbound => outbound?.server).map(outbound => outbound.tag);
        expect(tags).toContain('日本-01');
        expect(tags).toContain('美国-01');
        expect(tags).not.toContain('香港-01');
    });

    it('excludes matching nodes for clash keyword filters', async () => {
        const app = createTestApp();
        const res = await app.request(
            `http://localhost/clash?config=${encodeURIComponent(INPUT)}&node_filter_mode=exclude&node_filter_type=keyword&node_filter_values=${encodeURIComponent('香港,HK')}`
        );

        expect(res.status).toBe(200);
        const text = await res.text();
        expect(text).toContain('日本-01');
        expect(text).toContain('美国-01');
        expect(text).not.toContain('香港-01');
    });

    it('supports regex filters for surge', async () => {
        const app = createTestApp();
        const values = JSON.stringify(['^(日本|美国)-']);
        const res = await app.request(
            `http://localhost/surge?config=${encodeURIComponent(INPUT)}&node_filter_mode=include&node_filter_type=regex&node_filter_values=${encodeURIComponent(values)}`
        );

        expect(res.status).toBe(200);
        const text = await res.text();
        expect(text).toContain('日本-01');
        expect(text).toContain('美国-01');
        expect(text).not.toContain('香港-01');
    });

    it('returns 400 for invalid regex filters', async () => {
        const app = createTestApp();
        const res = await app.request(
            `http://localhost/clash?config=${encodeURIComponent(INPUT)}&node_filter_mode=include&node_filter_type=regex&node_filter_values=${encodeURIComponent('[香港')}`
        );

        expect(res.status).toBe(400);
        expect(await res.text()).toContain('Invalid node_filter_values regex');
    });

    it('returns 400 when the filter removes all nodes', async () => {
        const app = createTestApp();
        const values = JSON.stringify(['新加坡']);
        const res = await app.request(
            `http://localhost/singbox?config=${encodeURIComponent(INPUT)}&node_filter_mode=include&node_filter_type=keyword&node_filter_values=${encodeURIComponent(values)}`
        );

        expect(res.status).toBe(400);
        expect(await res.text()).toContain('Node filter removed all nodes');
    });

    it('disables provider passthrough when a node filter is active', async () => {
        const remoteSubscriptionUrl = 'https://airport.example.com/sub?token=abc';
        const remoteClashConfig = `proxies:\n  - name: HK-Node\n    type: ss\n    server: hk.example.com\n    port: 443\n    cipher: aes-128-gcm\n    password: test\n  - name: JP-Node\n    type: ss\n    server: jp.example.com\n    port: 443\n    cipher: aes-128-gcm\n    password: test\n`;

        vi.stubGlobal('fetch', vi.fn(async () => ({
            ok: true,
            status: 200,
            text: async () => remoteClashConfig,
            headers: { get: () => null }
        })));

        const app = createTestApp();
        const values = JSON.stringify(['JP']);
        const res = await app.request(
            `http://localhost/clash?config=${encodeURIComponent(remoteSubscriptionUrl)}&node_filter_mode=include&node_filter_type=keyword&node_filter_values=${encodeURIComponent(values)}`
        );

        expect(res.status).toBe(200);
        const text = await res.text();
        expect(text).toContain('JP-Node');
        expect(text).not.toContain('HK-Node');
    });
});
