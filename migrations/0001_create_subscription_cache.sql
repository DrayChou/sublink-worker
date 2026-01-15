-- D1 Schema for Subscription Cache
-- Purpose: Store subscription content permanently for offline access

CREATE TABLE IF NOT EXISTS subscription_cache (
    cache_key TEXT PRIMARY KEY,      -- Unique key (hash of URL)
    url TEXT NOT NULL,               -- Original URL (for reference)
    content TEXT NOT NULL,           -- Cached subscription content
    created_at INTEGER NOT NULL,     -- Timestamp when cached
    updated_at INTEGER NOT NULL,     -- Timestamp when last updated
    success_count INTEGER DEFAULT 1, -- Number of successful fetches
    fail_count INTEGER DEFAULT 0     -- Number of failed fetches
);

-- Index for quick lookups (optional, PRIMARY KEY already indexed)
CREATE INDEX IF NOT EXISTS idx_created_at ON subscription_cache(created_at DESC);
