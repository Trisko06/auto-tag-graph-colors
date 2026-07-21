// ─────────────────────────────────────────────────────────────
//  Auto Tag Graph Colors – graph integration
//
//  How colors are applied
//  ──────────────────────
//  1. updateInternalMemory(): sets instance.options.colorGroups directly,
//     then saves via gp.saveData() which writes the full graph.json.
//  2. writeGraphJson(): fallback that writes only colorGroups to graph.json.
//  3. callOnOptionsChange(): calls view.onOptionsChange() on every open
//     graph leaf — confirmed present via runtime debug.
//
//  NOTE: setViewState() was deliberately removed. It was overwriting
//  our colorGroups on every call because it restored the old cached state.
//
//  ⚠ LIMITATION – "Multi-tag" colour mode:
//     Obsidian colours each node by the FIRST matching color-group only.
//     The "multi" mode falls back to "primary" behaviour.
// ─────────────────────────────────────────────────────────────

import { App, WorkspaceLeaf, normalizePath } from 'obsidian';
import type { AutoTagGraphSettings, GraphColorGroup } from './types';
import { ColorManager } from './color-manager';

// ── Colour helpers ────────────────────────────────────────────

function hexToRgbTuple(hex: string): [number, number, number] {
    const c = hex.replace('#', '');
    return [
        parseInt(c.substring(0, 2), 16),
        parseInt(c.substring(2, 4), 16),
        parseInt(c.substring(4, 6), 16),
    ];
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const l = (max + min) / 2;
    let h = 0, s = 0;
    if (max !== min) {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
            case r: h = ((g - b) / d + (g < b ? 6 : 0)); break;
            case g: h = ((b - r) / d + 2); break;
            case b: h = ((r - g) / d + 4); break;
        }
        h *= 60;
    }
    return [h, s, l];
}

function hslToHex(h: number, s: number, l: number): string {
    h = ((h % 360) + 360) % 360;
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = l - c / 2;
    let r = 0, g = 0, b = 0;
    if      (h < 60)  { r = c; g = x; b = 0; }
    else if (h < 120) { r = x; g = c; b = 0; }
    else if (h < 180) { r = 0; g = c; b = x; }
    else if (h < 240) { r = 0; g = x; b = c; }
    else if (h < 300) { r = x; g = 0; b = c; }
    else              { r = c; g = 0; b = x; }
    const to = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, '0');
    return '#' + to(r) + to(g) + to(b);
}

/**
 * Heat gradient interpolation in HSL space.
 * Picks the hue path that AVOIDS green (60°-180°) so the gradient
 * goes cold → purple → hot instead of cold → green → hot.
 */
function interpolateColor(t: number, coldHex: string, hotHex: string): string {
    const [cr, cg, cb] = hexToRgbTuple(coldHex);
    const [hr, hg, hb] = hexToRgbTuple(hotHex);
    const [h1, s1, l1] = rgbToHsl(cr, cg, cb);
    const [h2, s2, l2] = rgbToHsl(hr, hg, hb);

    // Two possible paths around the hue wheel; pick the one whose midpoint
    // is NOT in the green zone (60°–180°).
    const directDelta = h2 - h1;
    const wrapDelta   = directDelta > 0 ? directDelta - 360 : directDelta + 360;
    const midDirect   = ((h1 + directDelta / 2) % 360 + 360) % 360;
    const useWrap     = midDirect > 60 && midDirect < 180;
    const delta       = useWrap ? wrapDelta : directDelta;

    const h = h1 + delta * t;
    const s = s1 + (s2 - s1) * t;
    const l = l1 + (l2 - l1) * t;
    return hslToHex(h, s, l);
}

export type ColorChangeCallback = (tag: string, newColor: string) => void;

// ── Internal plugin type stubs ────────────────────────────────

interface InternalGraphInstance {
    options?: { colorGroups?: GraphColorGroup[] };
}
interface InternalGraphPlugin {
    instance?: InternalGraphInstance;
}
interface InternalPlugins {
    plugins?: Record<string, InternalGraphPlugin>;
}

// ── Main class ────────────────────────────────────────────────

export class GraphIntegration {
    private app:      App;
    private settings: AutoTagGraphSettings;

    private legendByContainer: WeakMap<Element, HTMLElement> = new WeakMap();
    private allLegends:        Set<HTMLElement>               = new Set();

    constructor(app: App, settings: AutoTagGraphSettings) {
        this.app      = app;
        this.settings = settings;
    }

    updateSettings(settings: AutoTagGraphSettings): void {
        this.settings = settings;
    }

    /**
     * Compute the colour that will actually be painted on the graph for a note
     * tagged with ONLY this one tag, respecting the current mode (blend/mono).
     * Used by the legend and settings tag list so they mirror the graph output.
     */
    getDisplayColorForTag(tag: string, baseHex: string): string {
        if (!this.settings.blendTagsEnabled) return baseHex;

        // Deterministic per-tag hash (same as buildBlendedGroups with 1 tag)
        const sortedKey = tag;
        let hash = 0;
        for (let i = 0; i < sortedKey.length; i++) {
            hash = ((hash << 5) - hash) + sortedKey.charCodeAt(i);
            hash |= 0;
        }

        if (this.settings.blendMonochromeEnabled) {
            const [mr, mg, mb] = hexToRgbTuple(this.settings.blendMonochromeHue);
            const [monoH, monoS] = rgbToHsl(mr, mg, mb);
            const hVary = ((Math.abs(hash >> 6) % 600) - 300) / 10;
            const lVary = ((Math.abs(hash)      % 500) - 250) / 1000;
            const sVary = ((Math.abs(hash >> 3) % 300) - 150) / 1000;
            const h = ((monoH + hVary) % 360 + 360) % 360;
            const l = Math.min(0.80, Math.max(0.25, 0.55 + lVary));
            const s = Math.min(1,    Math.max(0.20, monoS + sVary));
            return hslToHex(h, s, l);
        }

        // Blend without monochrome: single-tag note → base with tiny hash variation
        const [br, bg, bb] = hexToRgbTuple(baseHex);
        let [h, s, l] = rgbToHsl(br, bg, bb);
        const lVary = ((Math.abs(hash) % 200) - 100) / 1000;
        l = Math.min(0.85, Math.max(0.30, l + lVary));
        return hslToHex(h, s, l);
    }

    // ── Colour application ────────────────────────────────────

    async applyColors(
        tagColors:      Record<string, string>,
        priorityTags:   string[],
        colorMode:      string,
        managedQueries: string[],
        fileTags?:      Map<string, string[]>,
    ): Promise<string[]> {
        const tagGroups = (this.settings.blendTagsEnabled && fileTags)
            ? this.buildBlendedGroups(fileTags, tagColors, priorityTags)
            : this.buildColorGroups(tagColors, priorityTags, colorMode);
        const heatGroups = this.settings.heatColoringEnabled
            ? this.computeHeatGroups()
            : [];
        const allGroups = [...heatGroups, ...tagGroups];

        // KEY INSIGHT (confirmed via console debug):
        // The ONLY method that actually repaints nodes is:
        //   view.dataEngine.setOptions({ colorGroups: [...] })
        // Per open graph view. Setting instance.options + view.update() /
        // onOptionsChange() does NOT trigger a visual repaint.
        //
        // We also persist to graph.json + instance.options so the colors
        // survive Obsidian restart and future graph opens.
        await this.writeGraphJson(allGroups, managedQueries);
        this.updateInternalMemory(allGroups, managedQueries);
        this.applyToDataEngines(allGroups, managedQueries);

        return allGroups.map(g => g.query);
    }

    /**
     * Remove every color-group this plugin has ever created (identified via
     * `managedQueries`) from graph.json, from the internal plugin memory, and
     * from every open graph view. Leaves user-added groups untouched.
     */
    async clearManagedGroups(managedQueries: string[]): Promise<void> {
        const managed = new Set(managedQueries);

        // 1) graph.json on disk
        try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const configDir = ((this.app.vault as any).configDir as string | undefined) ?? '.obsidian';
            const graphPath = normalizePath(`${configDir}/graph.json`);
            let current: { colorGroups?: GraphColorGroup[] } = {};
            try {
                current = JSON.parse(await this.app.vault.adapter.read(graphPath)) as typeof current;
            } catch { /* file may not exist */ }
            current.colorGroups = (current.colorGroups ?? []).filter(g => !managed.has(g.query));
            await this.app.vault.adapter.write(graphPath, JSON.stringify(current, null, 2));
        } catch (e) {
            console.debug('[ATGC] clearManagedGroups disk error:', e);
        }

        // 2) internal plugin memory
        try {
            const ip       = (this.app as unknown as { internalPlugins?: InternalPlugins }).internalPlugins;
            const gp       = ip?.plugins?.['graph'];
            const instance = gp?.instance;
            if (instance?.options?.colorGroups) {
                instance.options.colorGroups = instance.options.colorGroups.filter(g => !managed.has(g.query));
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const gpAny = gp as any;
                if (typeof gpAny.saveData === 'function') {
                    void (gpAny.saveData(instance.options) as unknown as Promise<void>);
                }
            }
        } catch (e) {
            console.debug('[ATGC] clearManagedGroups memory error:', e);
        }

        // 3) live open graph views
        for (const leaf of this.app.workspace.getLeavesOfType('graph')) {
            try {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const view = leaf.view as any;
                const de   = view.dataEngine;
                if (!de || typeof de.setOptions !== 'function') continue;
                const existing: GraphColorGroup[] = de.options?.colorGroups ?? [];
                de.setOptions({ colorGroups: existing.filter(g => !managed.has(g.query)) });
            } catch (e) {
                console.debug('[ATGC] clearManagedGroups view error:', e);
            }
        }
    }

    /** Log graph internals to the developer console for debugging. */
    logDebugInfo(): void {
        const ip   = (this.app as unknown as { internalPlugins?: InternalPlugins }).internalPlugins;
        const gp   = ip?.plugins?.['graph'];
        const inst = gp?.instance;
        console.group('[ATGC] Debug');
        console.log('graph plugin found:', !!gp);
        console.log('instance found:', !!inst);
        console.log('instance.options:', inst?.options);
        console.log('colorGroups count:', inst?.options?.colorGroups?.length ?? 0);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        console.log('gp.saveData type:', typeof (gp as any)?.saveData);
        const leaves = this.app.workspace.getLeavesOfType('graph');
        console.log('open graph leaves:', leaves.length);
        leaves.forEach((leaf, i) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const v = leaf.view as any;
            const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(v))
                .filter(n => typeof v[n] === 'function' && n !== 'constructor');
            console.log(`leaf ${i} proto methods:`, methods.join(', '));
        });
        console.groupEnd();
    }

    // ── Tag colour groups ─────────────────────────────────────

    private buildColorGroups(
        tagColors:    Record<string, string>,
        priorityTags: string[],
        colorMode:    string,
    ): GraphColorGroup[] {
        const entries = Object.entries(tagColors);
        let sorted: [string, string][];

        if (colorMode === 'priority' && priorityTags.length > 0) {
            const keys = priorityTags.map(t => this.normaliseKey(t));
            const set  = new Set(keys);
            const inP  = entries
                .filter(([t]) => set.has(t))
                .sort(([a], [b]) => keys.indexOf(a) - keys.indexOf(b));
            sorted = [...inP, ...entries.filter(([t]) => !set.has(t))];
        } else {
            sorted = entries;
        }

        return sorted.map(([tag, hex]) => ({
            query: `tag:${tag.startsWith('#') ? tag : `#${tag}`}`,
            color: { a: 1, rgb: ColorManager.hexToRgbInt(hex) },
        }));
    }

    private normaliseKey(t: string): string {
        return (t.startsWith('#') ? t : `#${t}`).toLowerCase();
    }

    // ── Smart tag blending ────────────────────────────────────

    /**
     * Emit one color-group per note whose colour is:
     *   base   = primary tag colour (priority list first, else file's first tag)
     *   hue    = shifted 15% toward the average hue of secondary tags
     *   light. = varied ±10% deterministically per tag-combo hash
     * Notes with identical tag sets end up with identical colours.
     */
    private buildBlendedGroups(
        fileTags:     Map<string, string[]>,
        tagColors:    Record<string, string>,
        priorityTags: string[],
    ): GraphColorGroup[] {
        const priKeys = priorityTags.map(t => this.normaliseKey(t));
        const groups: GraphColorGroup[] = [];

        // Monochrome sub-mode: force base hue from a fixed colour.
        const mono = this.settings.blendMonochromeEnabled;
        const [mr, mg, mb] = hexToRgbTuple(this.settings.blendMonochromeHue);
        const [monoH, monoS] = rgbToHsl(mr, mg, mb);

        for (const [filePath, tagsRaw] of fileTags) {
            const tags = tagsRaw.filter(t => tagColors[t]);
            if (tags.length === 0) continue;

            let primary = tags.find(t => priKeys.includes(t)) ?? tags[0];
            let h: number, s: number, l: number;

            if (mono) {
                // Fixed hue, vary lightness & saturation only.
                h = monoH;
                s = monoS;
                l = 0.55;
            } else {
                const baseHex = tagColors[primary];
                const [br, bg, bb] = hexToRgbTuple(baseHex);
                [h, s, l] = rgbToHsl(br, bg, bb);

                // Hue shift toward secondary tags' average hue (short-path)
                const others = tags.filter(t => t !== primary);
                if (others.length > 0) {
                    let acc = 0;
                    for (const t of others) {
                        const [r2, g2, b2] = hexToRgbTuple(tagColors[t]);
                        const [h2] = rgbToHsl(r2, g2, b2);
                        let delta = h2 - h;
                        if (delta >  180) delta -= 360;
                        if (delta < -180) delta += 360;
                        acc += delta;
                    }
                    h += (acc / others.length) * 0.15;
                }
                s = Math.min(1, s + Math.min(0.15, (tags.length - 1) * 0.03));
            }

            // Deterministic variation from the tag-set hash.
            const sortedKey = tags.slice().sort().join('|');
            let hash = 0;
            for (let i = 0; i < sortedKey.length; i++) {
                hash = ((hash << 5) - hash) + sortedKey.charCodeAt(i);
                hash |= 0;
            }
            if (mono) {
                // Wider spread so shades are actually distinguishable + subtle
                // hue drift into neighbouring colours (e.g. blue → cyan / purple).
                const hVary = ((Math.abs(hash >> 6) % 600) - 300) / 10;        // -30°..+30°
                const lVary = ((Math.abs(hash) % 500) - 250) / 1000;           // -0.25..+0.25
                const sVary = ((Math.abs(hash >> 3) % 300) - 150) / 1000;      // -0.15..+0.15
                h = ((monoH + hVary) % 360 + 360) % 360;
                l = Math.min(0.80, Math.max(0.25, l + lVary));
                s = Math.min(1,    Math.max(0.20, s + sVary));
            } else {
                const lVary = ((Math.abs(hash) % 200) - 100) / 1000;         // -0.10..+0.10
                l = Math.min(0.85, Math.max(0.30, l + lVary));
            }

            const hex  = hslToHex(h, s, l);
            const safe = filePath.replace(/"/g, '\\"');
            groups.push({
                query: `path:"${safe}"`,
                color: { a: 1, rgb: ColorManager.hexToRgbInt(hex) },
            });
        }

        return groups;
    }

    // ── Heat coloring ─────────────────────────────────────────

    private computeHeatGroups(): GraphColorGroup[] {
        const resolvedLinks = (
            this.app.metadataCache as unknown as {
                resolvedLinks?: Record<string, Record<string, number>>;
            }
        ).resolvedLinks;
        if (!resolvedLinks) return [];

        const counts = new Map<string, number>();
        for (const [from, links] of Object.entries(resolvedLinks)) {
            counts.set(from, (counts.get(from) ?? 0) + Object.keys(links).length);
            for (const to of Object.keys(links)) {
                counts.set(to, (counts.get(to) ?? 0) + 1);
            }
        }
        if (counts.size === 0) return [];

        // Rank-based (percentile) normalization so a single high-degree node
        // doesn't squash everyone else into the cold end. Ties share a rank.
        const entries = Array.from(counts.entries())
            .sort((a, b) => a[1] - b[1]); // ascending

        const rankOf = new Map<string, number>();
        let currentRank = 0;
        let prevCount   = Number.NEGATIVE_INFINITY;
        entries.forEach(([path, cnt], i) => {
            if (cnt !== prevCount) { currentRank = i; prevCount = cnt; }
            rankOf.set(path, currentRank);
        });
        const maxRank = Math.max(1, entries.length - 1);

        return entries.map(([filePath]) => {
            const t    = (rankOf.get(filePath) ?? 0) / maxRank;
            const hex  = interpolateColor(t, this.settings.heatColdColor, this.settings.heatHotColor);
            const safe = filePath.replace(/"/g, '\\"');
            return { query: `path:"${safe}"`, color: { a: 1, rgb: ColorManager.hexToRgbInt(hex) } };
        });
    }

    // ── Internal memory update ────────────────────────────────

    /**
     * Set colorGroups on the live options object and save via gp.saveData().
     * Returns true when gp.saveData was available and called.
     *
     * Confirmed via runtime debug:
     *   - instance.options EXISTS (showTags, search, etc.)
     *   - instance.save = undefined, instance.trigger = undefined
     *   - gp.saveData is the correct save method to check
     */
    private updateInternalMemory(
        newGroups:      GraphColorGroup[],
        managedQueries: string[],
    ): boolean {
        try {
            const ip       = (this.app as unknown as { internalPlugins?: InternalPlugins }).internalPlugins;
            const gp       = ip?.plugins?.['graph'];
            const instance = gp?.instance;
            if (!instance?.options) {
                return false;
            }

            const prev      = new Set(managedQueries);
            const inc       = new Set(newGroups.map(g => g.query));
            const existing: GraphColorGroup[] = instance.options.colorGroups ?? [];
            const preserved = existing.filter(g => !prev.has(g.query) && !inc.has(g.query));
            instance.options.colorGroups = [...preserved, ...newGroups];

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const gpAny = gp as any;
            if (typeof gpAny.saveData === 'function') {
                // eslint-disable-next-line @typescript-eslint/no-unsafe-call
                void (gpAny.saveData(instance.options) as unknown as Promise<void>);
                return true;
            }
            return false;
        } catch (e) {
            console.debug('[ATGC] updateInternalMemory error:', e);
            return false;
        }
    }

    // ── graph.json file-system fallback ──────────────────────

    private async writeGraphJson(
        newGroups:      GraphColorGroup[],
        managedQueries: string[],
    ): Promise<void> {
        try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const configDir = ((this.app.vault as any).configDir as string | undefined) ?? '.obsidian';
            const graphPath = normalizePath(`${configDir}/graph.json`);
            const prev      = new Set(managedQueries);
            const inc       = new Set(newGroups.map(g => g.query));

            let current: { colorGroups?: GraphColorGroup[] } = {};
            try {
                current = JSON.parse(await this.app.vault.adapter.read(graphPath)) as typeof current;
            } catch { /* file may not exist yet */ }

            const existing: GraphColorGroup[] = current.colorGroups ?? [];
            current.colorGroups = [
                ...existing.filter(g => !prev.has(g.query) && !inc.has(g.query)),
                ...newGroups,
            ];
            await this.app.vault.adapter.write(graphPath, JSON.stringify(current, null, 2));
        } catch (e) {
            console.error('[ATGC] writeGraphJson error:', e);
        }
    }

    // ── Graph view refresh ────────────────────────────────────

    /**
     * The ONLY confirmed working method to repaint graph nodes.
     * Calls view.dataEngine.setOptions({colorGroups}) on every open graph view.
     * Confirmed via runtime debug — dataEngine.setOptions is a real method
     * and it triggers the actual visual repaint.
     *
     * We merge with existing groups (preserving user-added ones not managed by us).
     */
    private applyToDataEngines(
        newGroups:      GraphColorGroup[],
        managedQueries: string[],
    ): void {
        const prev = new Set(managedQueries);
        const inc  = new Set(newGroups.map(g => g.query));

        for (const leaf of this.app.workspace.getLeavesOfType('graph')) {
            try {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const view = leaf.view as any;
                const de   = view.dataEngine;
                if (!de || typeof de.setOptions !== 'function') {
                    continue;
                }
                const existing: GraphColorGroup[] = de.options?.colorGroups ?? [];
                const preserved = existing.filter(g => !prev.has(g.query) && !inc.has(g.query));
                de.setOptions({ colorGroups: [...preserved, ...newGroups] });
            } catch (e) {
                console.debug('[ATGC] applyToDataEngines error:', e);
            }
        }
    }

    /**
     * onOptionsChange() confirmed present on graph view prototype.
     * It re-reads instance.options.colorGroups and repaints all nodes.
     * No setViewState — that was overwriting colorGroups.
     */
    private callOnOptionsChange(): void {
        for (const leaf of this.app.workspace.getLeavesOfType('graph')) {
            try {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const view = leaf.view as any;
                if (typeof view.onOptionsChange === 'function') {
                    view.onOptionsChange();
                }
            } catch (e) {
                console.debug('[ATGC] callOnOptionsChange error:', e);
            }
        }
    }

    // ── Legend overlay ────────────────────────────────────────

    updateLegend(
        leaf:          WorkspaceLeaf,
        tagColors:     Record<string, string>,
        tagCounts:     Map<string, number>,
        onColorChange: ColorChangeCallback,
        onToggle:      (visible: boolean) => void,
    ): void {
        const container = leaf.view.containerEl;

        const prev = this.legendByContainer.get(container);
        if (prev) {
            prev.remove();
            this.allLegends.delete(prev);
            this.legendByContainer.delete(container);
        }

        if (!this.settings.showLegend) return;

        const wrapper = this.buildLegend(tagColors, tagCounts, onColorChange, onToggle);
        container.appendChild(wrapper);
        this.legendByContainer.set(container, wrapper);
        this.allLegends.add(wrapper);
    }

    removeAllLegends(): void {
        this.allLegends.forEach(el => el.remove());
        this.allLegends.clear();
    }

    private buildLegend(
        tagColors:     Record<string, string>,
        tagCounts:     Map<string, number>,
        onColorChange: ColorChangeCallback,
        onToggle:      (visible: boolean) => void,
    ): HTMLElement {
        const wrapper = document.createElement('div');
        wrapper.className = 'atgc-legend-wrapper';

        // Toggle button (always visible)
        const tagCount  = Object.keys(tagColors).length;
        const toggleBtn = wrapper.createDiv({ cls: 'atgc-legend-toggle-btn' });
        toggleBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><circle cx="7" cy="7" r="1" fill="currentColor"/></svg><span>${tagCount}</span>`;
        toggleBtn.title = 'Tag Colours';

        // Expandable panel
        const panel  = wrapper.createDiv({ cls: 'atgc-legend-panel atgc-legend-panel-hidden' });
        const header = panel.createDiv({ cls: 'atgc-legend-panel-header' });
        header.createSpan({ text: 'Tag Colours' });
        const closeBtn = header.createEl('button', { cls: 'atgc-legend-close-btn', text: '\u00D7' });
        const body     = panel.createDiv({ cls: 'atgc-legend-panel-body' });

        const sorted = Object.entries(tagColors)
            .map(([tag, color]) => ({ tag, color, count: tagCounts.get(tag) ?? 0 }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 30);

        for (const entry of sorted) {
            const { tag } = entry;
            let { color } = entry;
            // Reflect the actual on-graph colour (blend / monochrome aware).
            color = this.getDisplayColorForTag(tag, color);
            entry.color = color;
            const item  = body.createDiv({ cls: 'atgc-legend-item' });
            const dot   = item.createSpan({ cls: 'atgc-legend-dot' });
            dot.style.backgroundColor = color;
            item.createSpan({ cls: 'atgc-legend-label', text: tag.replace(/^#/, '') });
            item.createSpan({ cls: 'atgc-legend-count', text: String(entry.count) });

            const picker = item.createEl('input', { cls: 'atgc-legend-picker' }) as HTMLInputElement;
            picker.type  = 'color';
            picker.value = color;
            picker.title = `Change colour for ${tag}`;
            // Prevent the native colour dialog's focus/click events from bubbling
            // up and closing the legend panel.
            const stop = (e: Event): void => { e.stopPropagation(); };
            ['click', 'mousedown', 'pointerdown', 'focus'].forEach(evt =>
                picker.addEventListener(evt, stop)
            );
            picker.addEventListener('input', (e) => {
                e.stopPropagation();
                color = picker.value;
                dot.style.backgroundColor = color;
                onColorChange(tag, color);
            });
            picker.addEventListener('change', (e) => { e.stopPropagation(); });
        }

        // Meetzy branding footer
        const footer = panel.createDiv({ cls: 'atgc-legend-footer' });
        footer.createSpan({ text: 'by ' });
        const brand = footer.createEl('a', {
            text: 'Meetzy Corp FZCO',
            cls:  'atgc-legend-brand',
            href: 'https://meetzy.ai',
        });
        brand.setAttr('target', '_blank');
        brand.setAttr('rel',    'noopener');
        brand.addEventListener('click', (e) => { e.stopPropagation(); });

        // Toggle: click button to open OR close
        const toggle = (): void => {
            const willOpen = panel.classList.contains('atgc-legend-panel-hidden');
            panel.classList.toggle('atgc-legend-panel-hidden', !willOpen);
            toggleBtn.classList.toggle('atgc-legend-toggle-active', willOpen);
            onToggle(willOpen);
        };
        toggleBtn.addEventListener('click', (e) => { e.stopPropagation(); toggle(); });
        closeBtn.addEventListener('click',  (e) => { e.stopPropagation(); toggle(); });

        // Restore last known state (default: closed)
        if (this.settings.legendVisible) {
            panel.classList.remove('atgc-legend-panel-hidden');
            toggleBtn.classList.add('atgc-legend-toggle-active');
        }

        return wrapper;
    }
}
