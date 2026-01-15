#!/usr/bin/env node
/**
 * Subscription Cache Manager
 *
 * Usage: node scripts/cache.js <url> <content_file> [--fix]
 *
 * Commands:
 *   insert  - Insert subscription content into D1 cache (default)
 *   fix     - Fix existing cache entry (delete and re-insert)
 *   delete  - Delete cache entry by URL
 *   list    - List all cached entries
 *   stats   - Show cache statistics
 *
 * Examples:
 *   node scripts/cache.js insert "https://example.com/sub" ./subscription.txt
 *   node scripts/cache.js fix "https://example.com/sub" ./subscription.txt
 *   node scripts/cache.js delete "https://example.com/sub"
 *   node scripts/cache.js list
 *   node scripts/cache.js stats
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// Generate cache key (same logic as cacheManager.js)
function generateCacheKey(url) {
    if (!url || typeof url !== 'string') {
        return 'invalid-url';
    }
    const encoder = new TextEncoder();
    const data = encoder.encode(url);
    let hash = 0;
    for (let i = 0; i < data.length; i++) {
        hash = ((hash << 5) - hash) + data[i];
        hash = hash & hash;
    }
    return Math.abs(hash).toString(16);
}

function showHelp() {
    console.log(`
Subscription Cache Manager

Usage: node scripts/cache.js <command> <url> [content_file]

Commands:
  insert <url> <file>  - Insert content into D1 cache
  fix    <url> <file>  - Fix existing cache (delete + re-insert)
  delete <url>         - Delete cache entry by URL
  list                 - List all cached entries
  stats                - Show cache statistics

Options:
  -h, --help           - Show this help message

Examples:
  node scripts/cache.js insert "https://example.com/sub?token=xxx" ./sub.txt
  node scripts/cache.js fix "https://example.com/sub?token=xxx" ./sub.txt
  node scripts/cache.js delete "https://example.com/sub?token=xxx"
  node scripts/cache.js list
  node scripts/cache.js stats
`);
}

function insertCache(url, contentFile) {
    if (!fs.existsSync(contentFile)) {
        console.error(`❌ Error: File not found: ${contentFile}`);
        process.exit(1);
    }

    const cacheKey = generateCacheKey(url);
    const content = fs.readFileSync(contentFile, 'utf-8');
    const escapedContent = content.replace(/'/g, "''");
    const escapedUrl = url.replace(/'/g, "''");
    const now = Date.now();

    console.log(`URL: ${url}`);
    console.log(`Cache Key: ${cacheKey}`);
    console.log(`Content: ${content.length} bytes`);

    const tempSqlFile = path.join(__dirname, '..', 'temp_cache_insert.sql');
    const sql = `
INSERT OR REPLACE INTO subscription_cache
(cache_key, url, content, created_at, updated_at, success_count, fail_count)
VALUES ('${cacheKey}', '${escapedUrl}', '${escapedContent}', ${now}, ${now}, 1, 0);
`.trim();

    fs.writeFileSync(tempSqlFile, sql);
    execSqlFile(tempSqlFile, 'insert');
}

function fixCache(url, contentFile) {
    if (!fs.existsSync(contentFile)) {
        console.error(`❌ Error: File not found: ${contentFile}`);
        process.exit(1);
    }

    const cacheKey = generateCacheKey(url);
    const content = fs.readFileSync(contentFile, 'utf-8');
    const escapedContent = content.replace(/'/g, "''");
    const escapedUrl = url.replace(/'/g, "''");
    const now = Date.now();

    console.log(`URL: ${url}`);
    console.log(`Cache Key: ${cacheKey}`);
    console.log(`Content: ${content.length} bytes`);

    const tempSqlFile = path.join(__dirname, '..', 'temp_cache_fix.sql');
    const sql = `
DELETE FROM subscription_cache WHERE cache_key = '${cacheKey}';
INSERT OR REPLACE INTO subscription_cache
(cache_key, url, content, created_at, updated_at, success_count, fail_count)
VALUES ('${cacheKey}', '${escapedUrl}', '${escapedContent}', ${now}, ${now}, 1, 0);
`.trim();

    fs.writeFileSync(tempSqlFile, sql);
    execSqlFile(tempSqlFile, 'fix');
}

function deleteCache(url) {
    const cacheKey = generateCacheKey(url);
    console.log(`URL: ${url}`);
    console.log(`Cache Key: ${cacheKey}`);

    const tempSqlFile = path.join(__dirname, '..', 'temp_cache_delete.sql');
    const sql = `DELETE FROM subscription_cache WHERE cache_key = '${cacheKey}';`;

    fs.writeFileSync(tempSqlFile, sql);
    execSqlFile(tempSqlFile, 'delete');
}

function listCache() {
    const tempSqlFile = path.join(__dirname, '..', 'temp_cache_list.sql');
    const sql = `SELECT cache_key, url, length(content) as size, success_count, fail_count, datetime(created_at/1000, 'unixepoch') as created FROM subscription_cache ORDER BY created_at DESC;`;

    fs.writeFileSync(tempSqlFile, sql);
    execSqlFile(tempSqlFile, 'list');
}

function showStats() {
    const tempSqlFile = path.join(__dirname, '..', 'temp_cache_stats.sql');
    const sql = `
SELECT
    COUNT(*) as total,
    SUM(success_count) as total_success,
    SUM(fail_count) as total_fail,
    SUM(length(content)) as total_size
FROM subscription_cache;
`.trim();

    fs.writeFileSync(tempSqlFile, sql);
    execSqlFile(tempSqlFile, 'stats');
}

function execSqlFile(sqlFile, action) {
    console.log(`\n🚀 Executing ${action}...`);

    try {
        const result = execSync(
            `npx wrangler d1 execute subscription-db --remote --file="${sqlFile}" --yes`,
            {
                cwd: path.join(__dirname, '..'),
                env: { ...process.env },
                encoding: 'utf-8'
            }
        );
        console.log(`\n✅ ${action.charAt(0).toUpperCase() + action.slice(1)} successful!`);
    } catch (error) {
        console.error(`\n❌ ${action} failed:`, error.message);
    } finally {
        try { fs.unlinkSync(sqlFile); } catch (e) {}
    }
}

// Main
const args = process.argv.slice(2);

if (args.includes('-h') || args.includes('--help') || args.length === 0) {
    showHelp();
    process.exit(0);
}

const command = args[0];
const url = args[1];
const contentFile = args[2];

switch (command) {
    case 'insert':
        if (!url || !contentFile) {
            console.error('❌ Error: Missing url or content_file');
            console.error('Usage: node scripts/cache.js insert <url> <content_file>');
            process.exit(1);
        }
        insertCache(url, contentFile);
        break;

    case 'fix':
        if (!url || !contentFile) {
            console.error('❌ Error: Missing url or content_file');
            console.error('Usage: node scripts/cache.js fix <url> <content_file>');
            process.exit(1);
        }
        fixCache(url, contentFile);
        break;

    case 'delete':
        if (!url) {
            console.error('❌ Error: Missing url');
            console.error('Usage: node scripts/cache.js delete <url>');
            process.exit(1);
        }
        deleteCache(url);
        break;

    case 'list':
        listCache();
        break;

    case 'stats':
        showStats();
        break;

    default:
        console.error(`❌ Unknown command: ${command}`);
        console.error('Run with -h for help');
        process.exit(1);
}
