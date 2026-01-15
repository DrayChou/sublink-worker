/**
 * Cache Manager for Subscription Content (D1-based)
 *
 * Purpose: Store subscription content permanently for offline access
 * Problem solved: Subscription links with time-limited tokens (10min/1-time use)
 *
 * Strategy:
 * - On fetch: try remote first, if success -> update cache
 * - On fetch failure: use cached content as fallback
 * - Cache never expires (until manually cleared)
 */

// Global reference to D1 binding (set from env in ES Module format)
let dbBinding = null;

// Set the D1 binding from env
export function setDbBinding(env) {
    if (env && env.SUBSCRIPTION_DB) {
        dbBinding = env.SUBSCRIPTION_DB;
    }
}

// Get the D1 binding
function getDb() {
    return dbBinding;
}

// User-Agent pool for retry mechanism
const USER_AGENTS = [
    // Real client headers from actual requests
    {
        ua: 'FlClash/v0.8.74 clash-verge Platform/windows',
        headers: {
            'accept-encoding': 'gzip, br',
            'connection': 'Keep-Alive',
            'user-agent': 'FlClash/v0.8.74 clash-verge Platform/windows',
            'x-forwarded-proto': 'https',
            'x-real-ip': '47.91.20.160'
        }
    },
    // Common proxy tool User-Agents
    { ua: 'curl/7.88.1', headers: { 'user-agent': 'curl/7.88.1' } },
    { ua: 'ClashforWindows/0.20.31', headers: { 'user-agent': 'ClashforWindows/0.20.31' } },
    { ua: 'clash-verge/v1.7.4', headers: { 'user-agent': 'clash-verge/v1.7.4' } },
    { ua: 'Surge/5.2.0', headers: { 'user-agent': 'Surge/5.2.0' } },
    { ua: 'Quantumult%20X/1.2.3', headers: { 'user-agent': 'Quantumult%20X/1.2.3' } },
    { ua: 'ShadowsocksX-NG/1.8.2', headers: { 'user-agent': 'ShadowsocksX-NG/1.8.2' } },
    // Browser-like headers for fallback
    {
        ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
        headers: {
            'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
            'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'accept-language': 'en-US,en;q=0.5'
        }
    },
    {
        ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.2 Safari/605.1.15',
        headers: {
            'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.2 Safari/605.1.15',
            'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        }
    }
];

// Generate cache key for URL (simple hash)
export function generateCacheKey(url) {
    const encoder = new TextEncoder();
    const data = encoder.encode(url);
    let hash = 0;
    for (let i = 0; i < data.length; i++) {
        const char = data.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return Math.abs(hash).toString(16);
}

// Fetch with retry mechanism
async function fetchWithRetry(url, options = {}, maxRetries = 3) {
    let lastError = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const uaIndex = (attempt - 1) % USER_AGENTS.length;
            const uaConfig = USER_AGENTS[uaIndex];

            const headers = new Headers(options.headers || {});

            // Only set User-Agent from pool
            if (!headers.has('user-agent')) {
                headers.set('user-agent', uaConfig.ua);
            }

            // Add real client headers only on first attempt
            if (attempt === 1) {
                for (const [key, value] of Object.entries(uaConfig.headers)) {
                    if (key !== 'user-agent') {
                        headers.set(key, value);
                    }
                }
            }

            const response = await fetch(url, {
                method: 'GET',
                headers,
                ...options
            });

            if (response.ok) {
                return await response.text();
            }

            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        } catch (error) {
            lastError = error;
            console.log(`Download attempt ${attempt} failed: ${url}, Error: ${error.message}`);
        }
    }

    throw lastError;
}

// Get cached content from D1
export async function getCachedContent(cacheKey) {
    const db = getDb();
    if (!db) {
        console.warn('D1 database not initialized');
        return null;
    }

    try {
        const result = await db.prepare(`
            SELECT content, success_count, fail_count, created_at
            FROM subscription_cache
            WHERE cache_key = ?
        `).bind(cacheKey).first();

        if (result) {
            console.log(`Cache hit for ${cacheKey}, created: ${new Date(result.created_at).toISOString()}`);
            return {
                content: result.content,
                successCount: result.success_count,
                failCount: result.fail_count,
                createdAt: result.created_at
            };
        }
    } catch (error) {
        console.error(`Error reading cache from D1 for ${cacheKey}:`, error);
    }
    return null;
}

// Save content to D1 cache (only on success)
export async function saveToCache(cacheKey, url, content) {
    const db = getDb();
    if (!db) {
        console.warn('D1 database not initialized');
        return false;
    }

    try {
        const now = Date.now();

        // Use INSERT OR REPLACE to update existing or insert new
        await db.prepare(`
            INSERT OR REPLACE INTO subscription_cache
            (cache_key, url, content, created_at, updated_at, success_count, fail_count)
            VALUES (?, ?, ?, ?, ?, COALESCE(
                (SELECT success_count + 1 FROM subscription_cache WHERE cache_key = ?),
                1
            ), COALESCE(
                (SELECT fail_count FROM subscription_cache WHERE cache_key = ?),
                0
            ))
        `).bind(cacheKey, url, content, now, now, cacheKey, cacheKey).run();

        console.log(`Cached ${cacheKey}, url: ${url.substring(0, 50)}...`);
        return true;
    } catch (error) {
        console.error(`Error saving cache to D1 for ${cacheKey}:`, error);
        return false;
    }
}

// Record a failed fetch attempt
export async function recordFailAttempt(cacheKey) {
    const db = getDb();
    if (!db) {
        return false;
    }

    try {
        await db.prepare(`
            UPDATE subscription_cache
            SET fail_count = fail_count + 1, updated_at = ?
            WHERE cache_key = ?
        `).bind(Date.now(), cacheKey).run();
        return true;
    } catch (error) {
        console.error(`Error recording fail for ${cacheKey}:`, error);
        return false;
    }
}

// Clear cache for a specific URL
export async function clearCache(cacheKey) {
    const db = getDb();
    if (!db) {
        return false;
    }

    try {
        await db.prepare(`
            DELETE FROM subscription_cache WHERE cache_key = ?
        `).bind(cacheKey).run();
        console.log(`Cache cleared for ${cacheKey}`);
        return true;
    } catch (error) {
        console.error(`Error clearing cache for ${cacheKey}:`, error);
        return false;
    }
}

// Get cache statistics
export async function getCacheStats() {
    const db = getDb();
    if (!db) {
        return { error: 'D1 database not initialized' };
    }

    try {
        const total = await db.prepare(`
            SELECT COUNT(*) as count FROM subscription_cache
        `).first();

        const withSuccess = await db.prepare(`
            SELECT COUNT(*) as count FROM subscription_cache WHERE success_count > 0
        `).first();

        return {
            totalCached: total?.count || 0,
            withSuccess: withSuccess?.count || 0
        };
    } catch (error) {
        return { error: error.message };
    }
}

// Clear all cache
export async function clearAllCache() {
    const db = getDb();
    if (!db) {
        return false;
    }

    try {
        await db.prepare(`DELETE FROM subscription_cache`).run();
        console.log('All cache cleared');
        return true;
    } catch (error) {
        console.error('Error clearing all cache:', error);
        return false;
    }
}

// Fetch with cache fallback (core logic)
// Strategy:
// 1. Try to fetch from remote
// 2. If success: update cache, return fresh content
// 3. If failure: return cached content (if exists)
export async function fetchWithCache(url, options = {}) {
    const cacheKey = generateCacheKey(url);
    const maxRetries = options.maxRetries || 3;

    // Try to fetch fresh content
    try {
        console.log(`Fetching: ${url}`);
        const content = await fetchWithRetry(url, options, maxRetries);

        // Success: update cache
        await saveToCache(cacheKey, url, content);

        return {
            content,
            fromCache: false,
            success: true
        };
    } catch (error) {
        console.error(`Fetch failed for ${url}:`, error.message);

        // Failure: try to use cached content as fallback
        const cached = await getCachedContent(cacheKey);

        if (cached && cached.content) {
            console.log(`Using cached content for ${cacheKey}`);
            return {
                content: cached.content,
                fromCache: true,
                success: true,
                warning: 'Remote fetch failed, using cached content'
            };
        }

        // No cache available
        return {
            content: null,
            fromCache: false,
            success: false,
            error: error.message
        };
    }
}

// D1 schema for subscription cache
const CREATE_TABLE_SQL = `
    CREATE TABLE IF NOT EXISTS subscription_cache (
        cache_key TEXT PRIMARY KEY,
        url TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        success_count INTEGER DEFAULT 1,
        fail_count INTEGER DEFAULT 0
    )
`;

// Auto-initialize D1 database schema
let dbInitialized = false;
export async function initDatabase(env) {
    // Set the D1 binding from env if provided
    if (env && env.SUBSCRIPTION_DB) {
        setDbBinding(env);
    }

    const db = getDb();
    if (dbInitialized || !db) {
        return dbInitialized;
    }

    try {
        await db.exec(CREATE_TABLE_SQL);
        dbInitialized = true;
        console.log('D1 subscription_cache table initialized');
        return true;
    } catch (error) {
        console.error('Failed to initialize D1 database:', error);
        return false;
    }
}

// Export for use in other modules
export default {
    generateCacheKey,
    fetchWithCache,
    getCachedContent,
    saveToCache,
    clearCache,
    clearAllCache,
    recordFailAttempt,
    getCacheStats,
    initDatabase,
    setDbBinding
};
