/**
 * 订阅内容缓存管理器
 * 解决订阅链接有时间限制的问题，提供高可用的缓存降级策略
 */

import { hashString } from './utils.js';

/**
 * 缓存配置常量
 */
const CACHE_CONFIG = {
    // 缓存键前缀
    PREFIX: 'subcache:',

    // 默认TTL（秒）
    DEFAULT_TTL: 3600,        // 1小时
    MAX_TTL: 86400,           // 24小时
    MIN_TTL: 300,             // 5分钟

    // 成功率阈值
    SUCCESS_THRESHOLD: 0.7,   // 70%成功率以上使用长缓存
    PENALTY_MULTIPLIER: 0.5,  // 失败时TTL惩罚系数
    REWARD_MULTIPLIER: 1.5,   // 成功时TTL奖励系数

    // 最大失败次数
    MAX_FAIL_COUNT: 10,
};

/**
 * 缓存数据结构
 * @typedef {Object} CacheEntry
 * @property {string} content - 下载的原始内容
 * @property {number} timestamp - 缓存时间戳
 * @property {number} successCount - 成功次数
 * @property {number} failCount - 失败次数
 * @property {number} lastSuccess - 最后成功时间戳
 * @property {number} ttl - 生存时间（秒）
 */

/**
 * 订阅内容缓存管理器
 */
export class SubscriptionCacheManager {
    /**
     * 构造函数
     * @param {Object} kvStore - KV存储实例
     */
    constructor(kvStore) {
        this.kv = kvStore;
    }

    /**
     * 生成缓存键
     * @param {string} url - 订阅URL
     * @returns {string} 缓存键
     */
    generateCacheKey(url) {
        const urlHash = hashString(url.trim());
        return `${CACHE_CONFIG.PREFIX}${urlHash}`;
    }

    /**
     * 计算动态TTL
     * @param {CacheEntry} entry - 缓存条目
     * @returns {number} TTL（秒）
     */
    calculateDynamicTTL(entry) {
        const totalRequests = entry.successCount + entry.failCount;

        if (totalRequests === 0) {
            return CACHE_CONFIG.DEFAULT_TTL;
        }

        const successRate = entry.successCount / totalRequests;
        let ttl = entry.ttl || CACHE_CONFIG.DEFAULT_TTL;

        // 根据成功率调整TTL
        if (successRate >= CACHE_CONFIG.SUCCESS_THRESHOLD) {
            // 成功率高，增加TTL
            ttl = Math.min(
                ttl * CACHE_CONFIG.REWARD_MULTIPLIER,
                CACHE_CONFIG.MAX_TTL
            );
        } else {
            // 成功率低，减少TTL
            ttl = Math.max(
                ttl * CACHE_CONFIG.PENALTY_MULTIPLIER,
                CACHE_CONFIG.MIN_TTL
            );
        }

        return Math.round(ttl);
    }

    /**
     * 更新缓存条目
     * @param {string} cacheKey - 缓存键
     * @param {string} content - 新内容
     * @param {CacheEntry|null} existingEntry - 现有缓存条目
     * @returns {Promise<void>}
     */
    async updateCache(cacheKey, content, existingEntry = null) {
        const now = Date.now();

        const entry = {
            content,
            timestamp: now,
            lastSuccess: now,
            successCount: existingEntry?.successCount || 0,
            failCount: existingEntry?.failCount || 0,
            ttl: existingEntry?.ttl || CACHE_CONFIG.DEFAULT_TTL
        };

        // 增加成功计数
        entry.successCount++;

        // 计算新的TTL
        entry.ttl = this.calculateDynamicTTL(entry);

        try {
            await this.kv.put(cacheKey, JSON.stringify(entry), {
                expirationTtl: entry.ttl
            });

            // 只在开发环境或调试模式下输出详细日志
            if (process.env.NODE_ENV !== 'production') {
                const successRate = (entry.successCount / (entry.successCount + entry.failCount) * 100).toFixed(1);
                console.log(`缓存更新: ${cacheKey}, TTL: ${entry.ttl}s, 成功率: ${successRate}%`);
            }
        } catch (error) {
            // 缓存更新失败不应该影响主流程，只在开发环境记录错误
            if (process.env.NODE_ENV !== 'production') {
                console.error('缓存更新失败:', error);
            }
        }
    }

    /**
     * 增加失败计数
     * @param {string} cacheKey - 缓存键
     * @returns {Promise<void>}
     */
    async incrementFailCount(cacheKey) {
        try {
            const cached = await this.kv.get(cacheKey, 'json');

            if (cached && typeof cached === 'object') {
                cached.failCount = (cached.failCount || 0) + 1;
                cached.ttl = this.calculateDynamicTTL(cached);

                // 如果失败次数太多，删除缓存
                if (cached.failCount >= CACHE_CONFIG.MAX_FAIL_COUNT) {
                    await this.kv.delete(cacheKey);
                    console.log(`缓存删除（失败次数过多）: ${cacheKey}`);
                    return;
                }

                await this.kv.put(cacheKey, JSON.stringify(cached), {
                    expirationTtl: cached.ttl
                });
            }
        } catch (error) {
            console.error('更新失败计数时出错:', error);
        }
    }

    /**
     * 获取缓存内容
     * @param {string} url - 订阅URL
     * @returns {Promise<CacheEntry|null>} 缓存条目或null
     */
    async getCache(url) {
        const cacheKey = this.generateCacheKey(url);

        try {
            const cached = await this.kv.get(cacheKey, 'json');

            if (cached && cached.content) {
                if (process.env.NODE_ENV !== 'production') {
                    const successRate = ((cached.successCount || 0) / ((cached.successCount || 0) + (cached.failCount || 0)) * 100).toFixed(1);
                    console.log(`缓存命中: ${cacheKey}, 成功率: ${successRate}%`);
                }
                return cached;
            }
        } catch (error) {
            console.error('读取缓存失败:', error);
        }

        return null;
    }

    /**
     * 带缓存的fetch操作
     * @param {string} url - 订阅URL
     * @param {Object} fetchOptions - fetch选项
     * @returns {Promise<string>} 下载的内容
     */
    async fetchWithCache(url, fetchOptions = {}) {
        const cacheKey = this.generateCacheKey(url);
        const cached = await this.getCache(url);

        // 安全的fetch选项白名单
        const safeOptions = {
            method: 'GET',
            headers: fetchOptions.headers || {},
            signal: AbortSignal.timeout(30000) // 30秒超时
        };

        // 首先尝试实时下载
        try {
            const response = await fetch(url, safeOptions);

            if (response.ok) {
                const content = await response.text();

                // 更新缓存
                await this.updateCache(cacheKey, content, cached);

                console.log(`实时下载成功: ${url}, 内容长度: ${content.length}`);
                return content;
            } else {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
        } catch (error) {
            if (process.env.NODE_ENV !== 'production') {
                console.warn(`实时下载失败: ${url}, 错误: ${error.message}`);
            }

            // 增加失败计数
            await this.incrementFailCount(cacheKey);

            // 尝试使用缓存
            if (cached && cached.content) {
                if (process.env.NODE_ENV !== 'production') {
                    console.log(`降级到缓存: ${cacheKey}, 缓存时间: ${new Date(cached.timestamp).toISOString()}`);
                }
                return cached.content;
            }

            // 如果既没有实时内容也没有缓存，抛出异常
            throw new Error(`下载失败且无可用缓存: ${url}`);
        }
    }

    /**
     * 预热缓存（可选功能）
     * @param {string[]} urls - 需要预热的URL列表
     * @param {Object} fetchOptions - fetch选项
     * @returns {Promise<void>}
     */
    async warmupCache(urls, fetchOptions = {}) {
        console.log(`开始预热缓存，URL数量: ${urls.length}`);

        const promises = urls.map(async (url) => {
            try {
                await this.fetchWithCache(url, fetchOptions);
                console.log(`预热成功: ${url}`);
            } catch (error) {
                console.error(`预热失败: ${url}, 错误: ${error.message}`);
            }
        });

        await Promise.allSettled(promises);
        console.log('缓存预热完成');
    }

    /**
     * 获取缓存统计信息
     * @param {string} url - 订阅URL
     * @returns {Promise<Object|null>} 统计信息
     */
    async getCacheStats(url) {
        const cached = await this.getCache(url);

        if (!cached) {
            return null;
        }

        const totalRequests = (cached.successCount || 0) + (cached.failCount || 0);
        const successRate = totalRequests > 0 ? (cached.successCount / totalRequests) : 0;

        return {
            cacheAge: Date.now() - cached.timestamp,
            lastSuccess: cached.lastSuccess,
            successCount: cached.successCount || 0,
            failCount: cached.failCount || 0,
            successRate: Math.round(successRate * 100) / 100,
            ttl: cached.ttl,
            hasContent: !!cached.content
        };
    }
}

// 默认导出实例
let defaultCacheManager = null;

export function initCacheManager(kvStore) {
    defaultCacheManager = new SubscriptionCacheManager(kvStore);
    return defaultCacheManager;
}

export function getCacheManager() {
    if (!defaultCacheManager) {
        throw new Error('CacheManager未初始化，请先调用initCacheManager(kvStore)');
    }
    return defaultCacheManager;
}

/**
 * 便捷函数：带缓存的fetch
 * @param {string} url - 订阅URL
 * @param {Object} fetchOptions - fetch选项
 * @returns {Promise<string>} 下载的内容
 */
export async function fetchWithSubscriptionCache(url, fetchOptions = {}) {
    const cacheManager = getCacheManager();
    return cacheManager.fetchWithCache(url, fetchOptions);
}