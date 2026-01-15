/**
 * D1 Database Setup Script
 * Automatically creates the subscription_cache table if it doesn't exist
 */

const { execSync } = require('child_process');
const path = require('path');

async function setupD1() {
    console.log('开始设置 D1 database...');

    const migrationFile = path.join(__dirname, '..', 'migrations', '0001_create_subscription_cache.sql');

    try {
        // Check if table exists
        console.log('检查 subscription_cache 表是否存在...');

        // Try to create the table (CREATE TABLE IF NOT EXISTS is idempotent)
        console.log('执行 D1 迁移...');
        execSync(`npx wrangler d1 execute subscription-db --remote --file="${migrationFile}" --yes`, {
            stdio: 'inherit',
            env: { ...process.env }
        });

        console.log('D1 设置完成！');
    } catch (error) {
        console.error('D1 设置失败:', error.message);
        // Don't exit, let deployment continue
        console.log('继续部署流程...');
    }
}

setupD1();
