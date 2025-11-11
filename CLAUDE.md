# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Sublink Worker is a serverless proxy subscription conversion service built on Cloudflare Workers. It converts proxy subscription links from various protocols into different configuration formats for proxy clients.

**Tech Stack**: JavaScript (ES6+), Cloudflare Workers, KV storage, js-yaml, Vitest for testing
**Runtime**: Node.js 18+ for development, Cloudflare Workers runtime in production

## Development Commands

### Core Development

```bash
# Start development server
npm run dev
# or
npm start

# Deploy to Cloudflare Workers
npm run deploy

# Run tests
npm test

# Setup KV namespace (run once)
npm run setup-kv
```

### Local Testing

```bash
# Run comprehensive local tests
node test-local.js
```

## Architecture

### Builder Pattern Architecture

The project uses a builder pattern for different configuration formats:

- **BaseConfigBuilder.js**: Abstract base class with common functionality
- **SingboxConfigBuilder.js**: Builds Sing-Box JSON configurations
- **ClashConfigBuilder.js**: Builds Clash YAML configurations
- **SurgeConfigBuilder.js**: Builds Surge text configurations

### Core Request Flow

1. **Main Handler**: `src/index.js` - routes requests and handles language detection
2. **Input Processing**: Accepts proxy URLs via query parameters (`?config=`) or POST requests
3. **Protocol Parsing**: `ProxyParsers.js` - converts various proxy protocol URLs to internal format
4. **Configuration Building**: Convert parsed proxies to client-specific formats
5. **Response**: Return configuration in requested format or HTML web interface

### Supported Protocols

- ShadowSocks
- VMess
- VLESS (including Reality)
- Hysteria2
- Trojan
- TUIC

### Output Formats

- Sing-Box (JSON) - `/singbox`
- Clash (YAML) - `/clash`
- Surge (text) - `/surge`
- Xray (base64 encoded) - `/xray`

## Key Files

### Main Application

- `src/index.js`: Request router and main handler
- `src/config.js`: Configuration constants and predefined rule sets
- `src/utils.js`: Utility functions (Base64 encoding, URL parsing)

### Configuration Builders

- `src/SingboxConfigBuilder.js`: Sing-Box output format
- `src/ClashConfigBuilder.js`: Clash output format
- `src/SurgeConfigBuilder.js`: Surge output format
- `src/ProxyParsers.js`: Protocol-specific URL parsers

### Web Interface

- `src/htmlBuilder.js`: Generates the web interface HTML
- `src/style.js`: CSS generation for the web interface
- `src/i18n/`: Internationalization system (supports Chinese, English, Persian)

## Configuration and Deployment

### Cloudflare Workers Configuration

- `wrangler.toml`: Main configuration file
- Uses `SUBLINK_KV` namespace for short link storage
- Requires Node.js 18+ compatibility

### Environment Setup

- Uses `pnpm` as package manager (see pnpm-lock.yaml)
- KV namespace must be created before first deployment (`npm run setup-kv`)
- Development uses `wrangler dev` for local testing

## Testing Strategy

### Test Files

- `test-local.js`: Comprehensive local testing script with YAML test cases
- `test-cases.yaml`: Test case definitions for various proxy protocols
- Uses Vitest for unit testing (configured in package.json)

### Manual Testing

The web interface (`/`) provides an interactive way to test different proxy inputs and configuration outputs.

## Development Patterns

### Error Handling

- All configuration builders extend BaseConfigBuilder with consistent error handling
- Invalid proxy URLs are logged but don't break the entire conversion process
- Missing required parameters result in 400 responses with descriptive messages

### Internationalization

- Uses `src/i18n/` system for multi-language support
- Language detection from URL parameter (`?lang=`) or `Accept-Language` header
- All user-facing strings use the `t()` function

### KV Storage Usage

- Short link generation and retrieval (`/shorten` endpoint)
- Caching of frequently accessed configurations
- Uses `GenerateWebPath()` utility for URL-safe key generation
