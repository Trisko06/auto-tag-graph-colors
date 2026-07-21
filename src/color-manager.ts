// ─────────────────────────────────────────────────────────────
//  Auto Tag Graph Colors – color generation & palette management
// ─────────────────────────────────────────────────────────────

import type { AutoTagGraphSettings, PaletteType } from './types';

// ── Palette definitions ──────────────────────────────────────

type NonHslPalette = Exclude<PaletteType, 'hsl'>;

/** Curated palettes, 20 colors each. */
const PALETTES: Record<NonHslPalette, string[]> = {
    modern: [
        '#6C5CE7', '#00B894', '#0984E3', '#00CEC9', '#FDCB6E',
        '#E17055', '#FD79A8', '#A29BFE', '#55EFC4', '#74B9FF',
        '#FF7675', '#D63031', '#8E44AD', '#16A085', '#2980B9',
        '#F39C12', '#27AE60', '#C0392B', '#E84393', '#00897B',
    ],
    pastel: [
        '#C9C0F9', '#A8E6D5', '#B3D5F0', '#A8E4E4', '#FDEAB7',
        '#F5CBBD', '#FEBDD6', '#D5D0FC', '#A8F0DE', '#C5E0FC',
        '#FFBABA', '#B0EAEA', '#FEFAC8', '#F8C8D8', '#D5C5E6',
        '#E8C8F0', '#C8E8A8', '#F0D8C8', '#C8D0F8', '#E8F0C8',
    ],
    'high-contrast': [
        '#7B00FF', '#00CC44', '#0077FF', '#00CCCC', '#FFB300',
        '#FF4400', '#FF0088', '#8855FF', '#00FF99', '#3399FF',
        '#FF3333', '#00FFFF', '#FFE000', '#FF8800', '#AA00FF',
        '#FF0055', '#0055FF', '#00FF44', '#FF6600', '#CC00CC',
    ],
    'dark-optimized': [
        '#9B89FF', '#20D8A0', '#2BB5FF', '#1DDDDD', '#FFD166',
        '#FF8C6B', '#FF91C1', '#B8AAFF', '#6FFFD3', '#7FC5FF',
        '#FF8585', '#6EF7F7', '#FFEF85', '#FFA85C', '#C87AFF',
        '#FF6B9D', '#6B96FF', '#5BFFA0', '#FFA040', '#E060EE',
    ],
    /** Wong (2011) colorblind-safe palette + extensions */
    colorblind: [
        '#E69F00', '#56B4E9', '#009E73', '#F0E442', '#0072B2',
        '#D55E00', '#CC79A7', '#44AA99', '#882255', '#117733',
        '#332288', '#DDCC77', '#88CCEE', '#AA4499', '#999933',
        '#6699CC', '#661100', '#AA7744', '#4477AA', '#228833',
    ],
};

// ── Math helpers ─────────────────────────────────────────────

/** Golden angle in degrees — maximises hue separation for sequential indexes */
const GOLDEN_ANGLE = 137.50776405003785;

/** Non-cryptographic DJB2 hash — deterministic, stable across runs */
function djb2Hash(str: string): number {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
        hash = hash >>> 0; // unsigned 32-bit
    }
    return hash;
}

/** Convert HSL (h 0-360, s 0-100, l 0-100) to a hex colour string */
function hslToHex(h: number, s: number, l: number): string {
    const sn = s / 100;
    const ln = l / 100;
    const a  = sn * Math.min(ln, 1 - ln);
    const f  = (n: number): string => {
        const k     = (n + h / 30) % 12;
        const color = ln - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
        return Math.round(255 * color).toString(16).padStart(2, '0');
    };
    return `#${f(0)}${f(8)}${f(4)}`;
}

/** Weighted Euclidean distance in RGB — approximates human perception */
function perceptualDistance(hex1: string, hex2: string): number {
    const parse = (h: string) => [
        parseInt(h.slice(1, 3), 16),
        parseInt(h.slice(3, 5), 16),
        parseInt(h.slice(5, 7), 16),
    ] as const;
    const [r1, g1, b1] = parse(hex1);
    const [r2, g2, b2] = parse(hex2);
    return Math.sqrt(
        (r1 - r2) ** 2 * 0.299 +
        (g1 - g2) ** 2 * 0.587 +
        (b1 - b2) ** 2 * 0.114,
    );
}

// ── Public API ───────────────────────────────────────────────

export class ColorManager {
    private settings: AutoTagGraphSettings;

    constructor(settings: AutoTagGraphSettings) {
        this.settings = settings;
    }

    updateSettings(settings: AutoTagGraphSettings): void {
        this.settings = settings;
    }

    /**
     * Generate (or retrieve from palette) a colour for a tag.
     *
     * @param tag           Tag string (with or without leading #)
     * @param existingColors Already-assigned hex colours (for contrast optimisation)
     */
    generateColorForTag(tag: string, existingColors: string[] = []): string {
        const key = tag.replace(/^#/, '').toLowerCase();
        if (this.settings.palette === 'hsl') {
            return this.generateHSLColor(key);
        }
        return this.generatePaletteColor(key, existingColors);
    }

    private generateHSLColor(key: string): string {
        const hash  = djb2Hash(key);
        const index = hash % 360; // use hash directly as index for the golden-angle sequence
        const hue   = (index * GOLDEN_ANGLE) % 360;
        return hslToHex(hue, this.settings.saturation, this.settings.lightness);
    }

    private generatePaletteColor(key: string, existingColors: string[]): string {
        const palette    = PALETTES[this.settings.palette as NonHslPalette];
        const hash       = djb2Hash(key);
        const startIndex = hash % palette.length;

        if (existingColors.length === 0) {
            return palette[startIndex];
        }

        // Walk palette from hash-determined start; pick candidate with max
        // minimum-distance to all already-assigned colours.
        let bestColor   = palette[startIndex];
        let bestMinDist = -1;

        for (let i = 0; i < palette.length; i++) {
            const candidate = palette[(startIndex + i) % palette.length];
            const minDist   = existingColors.reduce(
                (min, ec) => Math.min(min, perceptualDistance(candidate, ec)),
                Infinity,
            );
            if (minDist > bestMinDist) {
                bestMinDist = minDist;
                bestColor   = candidate;
            }
        }
        return bestColor;
    }

    /**
     * Produce a slightly lighter/different shade of a parent colour for subtags.
     * depth=1 → one level below parent, depth=2 → two levels, etc.
     */
    generateChildColor(parentColor: string, depth: number): string {
        const r      = parseInt(parentColor.slice(1, 3), 16);
        const g      = parseInt(parentColor.slice(3, 5), 16);
        const b      = parseInt(parentColor.slice(5, 7), 16);
        const blend  = Math.min(depth * 0.12, 0.45); // blend toward white
        const lr     = Math.round(r + (255 - r) * blend);
        const lg     = Math.round(g + (255 - g) * blend);
        const lb     = Math.round(b + (255 - b) * blend);
        return `#${lr.toString(16).padStart(2, '0')}${lg.toString(16).padStart(2, '0')}${lb.toString(16).padStart(2, '0')}`;
    }

    /** Returns the parent tag string (without #), or null if top-level. */
    getParentTag(tag: string): string | null {
        const clean = tag.replace(/^#/, '');
        const idx   = clean.lastIndexOf('/');
        return idx === -1 ? null : clean.substring(0, idx);
    }

    /** Returns nesting depth: #foo → 0, #foo/bar → 1, #foo/bar/baz → 2 */
    getTagDepth(tag: string): number {
        return (tag.replace(/^#/, '').match(/\//g) ?? []).length;
    }

    // ── Static utilities shared by graph-integration ──────────

    static hexToRgbInt(hex: string): number {
        const clean = hex.replace('#', '');
        const r     = parseInt(clean.substring(0, 2), 16);
        const g     = parseInt(clean.substring(2, 4), 16);
        const b     = parseInt(clean.substring(4, 6), 16);
        return ((r & 0xff) << 16) | ((g & 0xff) << 8) | (b & 0xff);
    }

    static rgbIntToHex(rgb: number): string {
        const r = (rgb >> 16) & 0xff;
        const g = (rgb >> 8)  & 0xff;
        const b =  rgb        & 0xff;
        return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
    }
}
