// ─────────────────────────────────────────────────────────────
//  Auto Tag Graph Colors – shared types
// ─────────────────────────────────────────────────────────────

export type ColorMode   = 'primary' | 'priority' | 'multi';
export type SubtagMode  = 'separate' | 'inherit';
export type PaletteType =
    | 'modern'
    | 'pastel'
    | 'high-contrast'
    | 'dark-optimized'
    | 'colorblind'
    | 'hsl';

/** A single color-group entry stored in Obsidian's graph.json */
export interface GraphColorGroup {
    query: string;
    color: { a: number; rgb: number };
}

export interface AutoTagGraphSettings {
    enabled:              boolean;
    colorMode:            ColorMode;
    subtagMode:           SubtagMode;
    palette:              PaletteType;
    /** Saturation % used by the HSL palette (0–100) */
    saturation:           number;
    /** Lightness % used by the HSL palette (0–100) */
    lightness:            number;
    excludedTags:         string[];
    priorityTags:         string[];
    /** tag → hex color, e.g. "#meetzy" → "#6C5CE7" */
    tagColors:            Record<string, string>;
    /** tag → locked flag – locked tags are never auto-regenerated */
    lockedColors:         Record<string, boolean>;
    autoRefresh:          boolean;
    ignoreSingleUseTags:  boolean;
    showLegend:           boolean;
    legendVisible:        boolean;
    lastScanTime:         number;
    /**
     * Queries that ATGC has written to graph.json.
     * Used to safely remove stale entries on the next apply pass.
     */
    managedQueries:       string[];

    // ── Heat coloring ───────────────────────────────────────
    /** Color nodes by connection count (cold = few links, hot = many links) */
    heatColoringEnabled:  boolean;
    /** Hex colour for nodes with the fewest connections */
    heatColdColor:        string;
    /** Hex colour for nodes with the most connections */
    heatHotColor:         string;
    // ── Smart tag blending ─────────────────────
    /**
     * When true, each note gets its own colour computed from its full tag set:
     * base = primary tag colour, subtly shifted toward the average hue of
     * secondary tags, with a small lightness variation per tag count.
     * Notes sharing the same tag combination get identical colours.
     */
    blendTagsEnabled:     boolean;
    /**
     * Sub-mode of blending: force every note to a monochrome variation of
     * `blendMonochromeHue`. Different tag combos still get distinct shades
     * (lightness + subtle saturation variation) but the hue stays fixed.
     */
    blendMonochromeEnabled: boolean;
    /** Base hex colour used when blendMonochromeEnabled is on. */
    blendMonochromeHue:     string;
}

export const DEFAULT_SETTINGS: AutoTagGraphSettings = {
    enabled:             true,
    colorMode:           'primary',
    subtagMode:          'separate',
    palette:             'modern',
    saturation:          65,
    lightness:           55,
    excludedTags:        [],
    priorityTags:        [],
    tagColors:           {},
    lockedColors:        {},
    autoRefresh:         true,
    ignoreSingleUseTags: false,
    showLegend:          true,
    legendVisible:        false,
    lastScanTime:        0,
    managedQueries:      [],
    heatColoringEnabled: false,
    heatColdColor:       '#4A90D9',
    heatHotColor:        '#E74C3C',
    blendTagsEnabled:    false,
    blendMonochromeEnabled: false,
    blendMonochromeHue:     '#4A90D9',
};
