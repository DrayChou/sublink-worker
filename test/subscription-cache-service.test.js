import { afterEach, describe, expect, it, vi } from 'vitest';
import { SubscriptionCacheService, buildCacheLookupKeys, generateCacheKey } from '../src/services/subscriptionCacheService.js';

const URL = 'https://airport.example.com/sub?token=abc';

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('SubscriptionCacheService', () => {
    it('uses different primary cache keys for different user agents while retaining legacy fallback', () => {
        const chromeKeys = buildCacheLookupKeys(URL, { headers: { 'User-Agent': 'Clash-Verge/1.7.4' } });
        const safariKeys = buildCacheLookupKeys(URL, { headers: { 'User-Agent': 'Surge/5.2.0' } });
        const legacyKey = generateCacheKey(URL);

        expect(chromeKeys.primaryKey).not.toBe(safariKeys.primaryKey);
        expect(chromeKeys.fallbackKeys).toContain(legacyKey);
        expect(safariKeys.fallbackKeys).toContain(legacyKey);
    });

    it('falls back to legacy URL-only cache entries when UA-specific cache misses', async () => {
        const service = new SubscriptionCacheService({});
        vi.spyOn(service, 'init').mockResolvedValue(true);
        const recordFailAttempt = vi.spyOn(service, 'recordFailAttempt').mockResolvedValue(true);
        const saveToCache = vi.spyOn(service, 'saveToCache').mockResolvedValue(true);
        const legacyKey = generateCacheKey(URL);
        const { primaryKey } = buildCacheLookupKeys(URL, { headers: { 'User-Agent': 'Clash-Verge/1.7.4' } });

        const getCachedContent = vi.spyOn(service, 'getCachedContent').mockImplementation(async (cacheKey) => {
            if (cacheKey === primaryKey) {
                return null;
            }
            if (cacheKey === legacyKey) {
                return {
                    content: 'cached-content',
                    subscriptionUserinfo: 'upload=1; download=2'
                };
            }
            return null;
        });

        vi.stubGlobal('fetch', vi.fn(async () => {
            throw new Error('upstream down');
        }));

        const result = await service.fetchWithCache(URL, {
            headers: { 'User-Agent': 'Clash-Verge/1.7.4' }
        });

        expect(result.success).toBe(true);
        expect(result.fromCache).toBe(true);
        expect(result.content).toBe('cached-content');
        expect(getCachedContent).toHaveBeenNthCalledWith(1, primaryKey);
        expect(getCachedContent).toHaveBeenNthCalledWith(2, legacyKey);
        expect(recordFailAttempt).toHaveBeenCalledWith(primaryKey);
        expect(saveToCache).toHaveBeenCalledWith(primaryKey, URL, 'cached-content', 'upload=1; download=2');
    });

    it('falls back to cached content when a 200 response fails semantic validation', async () => {
        const service = new SubscriptionCacheService({});
        vi.spyOn(service, 'init').mockResolvedValue(true);
        const recordFailAttempt = vi.spyOn(service, 'recordFailAttempt').mockResolvedValue(true);
        const saveToCache = vi.spyOn(service, 'saveToCache').mockResolvedValue(true);
        const { primaryKey } = buildCacheLookupKeys(URL, { headers: { 'User-Agent': 'Clash-Verge/1.7.4' } });

        vi.spyOn(service, 'getCachedContent').mockResolvedValue({
            content: 'cached-content',
            subscriptionUserinfo: 'upload=1; download=2'
        });

        vi.stubGlobal('fetch', vi.fn(async () => ({
            ok: true,
            status: 200,
            text: async () => '',
            headers: { get: () => null }
        })));

        const result = await service.fetchWithCache(URL, {
            headers: { 'User-Agent': 'Clash-Verge/1.7.4' },
            validateFreshContent: (content) => content.trim() !== ''
        });

        expect(result.success).toBe(true);
        expect(result.fromCache).toBe(true);
        expect(result.content).toBe('cached-content');
        expect(recordFailAttempt).toHaveBeenCalledWith(primaryKey);
        expect(saveToCache).not.toHaveBeenCalled();
    });

    it('deduplicates concurrent fetches for the same cache key', async () => {
        const service = new SubscriptionCacheService({});
        vi.spyOn(service, 'init').mockResolvedValue(true);
        vi.spyOn(service, 'saveToCache').mockResolvedValue(true);
        vi.spyOn(service, 'getCachedContent').mockResolvedValue(null);

        const fetchSpy = vi.fn(async () => {
            await new Promise(resolve => setTimeout(resolve, 20));
            return {
                ok: true,
                status: 200,
                text: async () => 'fresh-content',
                headers: { get: () => null }
            };
        });
        vi.stubGlobal('fetch', fetchSpy);

        const [first, second] = await Promise.all([
            service.fetchWithCache(URL, { headers: { 'User-Agent': 'Clash-Verge/1.7.4' } }),
            service.fetchWithCache(URL, { headers: { 'User-Agent': 'Clash-Verge/1.7.4' } })
        ]);

        expect(first.success).toBe(true);
        expect(second.success).toBe(true);
        expect(first.content).toBe('fresh-content');
        expect(second.content).toBe('fresh-content');
        expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
});
