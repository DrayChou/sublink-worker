import { InvalidPayloadError } from './services/errors.js';

const NODE_FILTER_MODES = new Set(['include', 'exclude']);
const NODE_FILTER_TYPES = new Set(['keyword', 'regex']);

function normalizeFilterValues(values) {
    if (Array.isArray(values)) {
        return values
            .map(value => typeof value === 'string' ? value.trim() : '')
            .filter(Boolean);
    }

    if (typeof values !== 'string') {
        return [];
    }

    const trimmed = values.trim();
    if (!trimmed) {
        return [];
    }

    try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
            return parsed
                .map(value => typeof value === 'string' ? value.trim() : '')
                .filter(Boolean);
        }
    } catch {
        // Fallback to delimited string parsing for URL-friendly query params.
    }

    return trimmed
        .split(/[\n,]+/)
        .map(value => value.trim())
        .filter(Boolean);
}

export function parseNodeFilter(rawMode, rawType, rawValues) {
    if (!rawMode && !rawType && !rawValues) {
        return null;
    }

    if (!rawMode || !rawType || !rawValues) {
        throw new InvalidPayloadError('node_filter_mode, node_filter_type, and node_filter_values must be provided together');
    }

    const mode = String(rawMode).trim().toLowerCase();
    const type = String(rawType).trim().toLowerCase();

    if (!NODE_FILTER_MODES.has(mode)) {
        throw new InvalidPayloadError('Invalid node_filter_mode: must be include or exclude');
    }

    if (!NODE_FILTER_TYPES.has(type)) {
        throw new InvalidPayloadError('Invalid node_filter_type: must be keyword or regex');
    }

    const values = normalizeFilterValues(rawValues);
    if (values.length === 0) {
        throw new InvalidPayloadError('node_filter_values must contain at least one keyword or regex pattern');
    }

    if (type === 'regex') {
        try {
            return {
                mode,
                type,
                values,
                matchers: values.map(pattern => new RegExp(pattern, 'i'))
            };
        } catch (error) {
            throw new InvalidPayloadError(`Invalid node_filter_values regex: ${error.message}`);
        }
    }

    return {
        mode,
        type,
        values,
        matchers: values.map(value => value.toLocaleLowerCase())
    };
}

export function matchesNodeTitle(title, nodeFilter) {
    if (!nodeFilter) {
        return true;
    }

    const normalizedTitle = typeof title === 'string' ? title : '';
    if (!normalizedTitle) {
        return false;
    }

    if (nodeFilter.type === 'regex') {
        return nodeFilter.matchers.some(pattern => pattern.test(normalizedTitle));
    }

    const lowerTitle = normalizedTitle.toLocaleLowerCase();
    return nodeFilter.matchers.some(keyword => lowerTitle.includes(keyword));
}

export function filterNodesByTitle(items, nodeFilter, getName = (item) => item?.tag ?? item?.name ?? '') {
    if (!nodeFilter) {
        return items;
    }

    return items.filter(item => {
        const matched = matchesNodeTitle(getName(item), nodeFilter);
        return nodeFilter.mode === 'include' ? matched : !matched;
    });
}
