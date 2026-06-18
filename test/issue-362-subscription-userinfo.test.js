import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app/createApp.jsx';
import { MemoryKVAdapter } from '../src/adapters/kv/memoryKv.js';
import { decodeBase64 } from '../src/utils.js';

const subscriptionUserinfo = 'upload=123; download=456; total=1024; expire=1893456000';
const remoteSubscriptionUrl = 'https://airport.example.com/sub?token=abc';
const proxyUri = 'ss://YWVzLTEyOC1nY206cGFzcw@example.com:443#Issue362';

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

function mockRemoteSubscription() {
    vi.stubGlobal('fetch', vi.fn(async () => ({
        ok: true,
        status: 200,
        text: async () => proxyUri,
        headers: {
            get: (name) => name.toLowerCase() === 'subscription-userinfo'
                ? subscriptionUserinfo
                : null
        }
    })));
}

function createCacheService() {
    return {
        fetchWithCache: vi.fn(async () => ({
            success: true,
            fromCache: true,
            content: proxyUri,
            subscriptionUserinfo
        }))
    };
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('Issue #362 - subscription userinfo passthrough', () => {
    it('preserves subscription-userinfo for Clash remote subscriptions', async () => {
        mockRemoteSubscription();
        const app = createTestApp();

        const res = await app.request(`http://localhost/clash?config=${encodeURIComponent(remoteSubscriptionUrl)}`);

        expect(res.status).toBe(200);
        expect(res.headers.get('subscription-userinfo')).toBe(subscriptionUserinfo);
        expect(await res.text()).toContain('Issue362');
    });

    it('preserves subscription-userinfo for Sing-Box remote subscriptions', async () => {
        mockRemoteSubscription();
        const app = createTestApp();

        const res = await app.request(`http://localhost/singbox?config=${encodeURIComponent(remoteSubscriptionUrl)}`);

        expect(res.status).toBe(200);
        expect(res.headers.get('subscription-userinfo')).toBe(subscriptionUserinfo);
        const json = await res.json();
        expect(json.outbounds.some(outbound => outbound.tag === 'Issue362')).toBe(true);
    });

    it('preserves subscription-userinfo for Surge remote subscriptions', async () => {
        mockRemoteSubscription();
        const app = createTestApp();

        const res = await app.request(`http://localhost/surge?config=${encodeURIComponent(remoteSubscriptionUrl)}`);

        expect(res.status).toBe(200);
        expect(res.headers.get('subscription-userinfo')).toBe(subscriptionUserinfo);
        expect(await res.text()).toContain('Issue362');
    });

    it('preserves subscription-userinfo for Xray remote subscriptions', async () => {
        mockRemoteSubscription();
        const app = createTestApp();

        const res = await app.request(`http://localhost/xray?config=${encodeURIComponent(remoteSubscriptionUrl)}`);

        expect(res.status).toBe(200);
        expect(res.headers.get('subscription-userinfo')).toBe(subscriptionUserinfo);
        expect(decodeBase64(await res.text())).toBe(proxyUri);
    });

    it('preserves subscription-userinfo for cached Clash subscriptions', async () => {
        const subscriptionCache = createCacheService();
        const app = createTestApp({ subscriptionCache });

        const res = await app.request(`http://localhost/clash?config=${encodeURIComponent(remoteSubscriptionUrl)}`);

        expect(res.status).toBe(200);
        expect(subscriptionCache.fetchWithCache).toHaveBeenCalledTimes(1);
        expect(res.headers.get('subscription-userinfo')).toBe(subscriptionUserinfo);
        expect(await res.text()).toContain('Issue362');
    });

    it('preserves subscription-userinfo for cached Xray subscriptions', async () => {
        const subscriptionCache = createCacheService();
        const app = createTestApp({ subscriptionCache });

        const res = await app.request(`http://localhost/xray?config=${encodeURIComponent(remoteSubscriptionUrl)}`);

        expect(res.status).toBe(200);
        expect(subscriptionCache.fetchWithCache).toHaveBeenCalledTimes(1);
        expect(res.headers.get('subscription-userinfo')).toBe(subscriptionUserinfo);
        expect(decodeBase64(await res.text())).toBe(proxyUri);
    });
});
