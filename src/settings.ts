// ─────────────────────────────────────────────────────────────
//  Auto Tag Graph Colors – settings tab
// ─────────────────────────────────────────────────────────────

import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import type { ColorMode, PaletteType, SubtagMode } from './types';
import type AutoTagGraphColorsPlugin from './main';

export class AutoTagGraphSettingTab extends PluginSettingTab {
    plugin: AutoTagGraphColorsPlugin;
    private applyTimer: ReturnType<typeof setTimeout> | null = null;

    constructor(app: App, plugin: AutoTagGraphColorsPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    /** Debounced full rescan + apply — for text inputs typed by the user. */
    private scheduleRescan(delay = 400): void {
        if (this.applyTimer) clearTimeout(this.applyTimer);
        this.applyTimer = setTimeout(() => { void this.plugin.fullScanAndApply(); }, delay);
    }

    /** Debounced re-apply of current colours (no rescan). */
    private scheduleApply(delay = 200): void {
        if (this.applyTimer) clearTimeout(this.applyTimer);
        this.applyTimer = setTimeout(() => { void this.plugin.applyCurrentColors(); }, delay);
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.addClass('atgc-settings');

        this.renderHeader(containerEl);
        this.renderGeneral(containerEl);
        this.renderScan(containerEl);
        this.renderColors(containerEl);
        this.renderDisplay(containerEl);
        this.renderTagList(containerEl);
        this.renderFooter(containerEl);
    }

    // ── Header ────────────────────────────────────────────────

    private renderHeader(el: HTMLElement): void {
        const header = el.createDiv({ cls: 'atgc-header' });

        // Tagline
        header.createEl('p', {
            cls:  'atgc-subtitle',
            text: 'Automatically assign distinct, stable colors to every tag in your vault and paint them onto the graph view. Pick a palette, hit scan, and your knowledge graph becomes a color-coded map of your thinking.',
        });

        // About Meetzy — subtle author card
        const about = header.createDiv({ cls: 'atgc-about' });
        const aboutText = about.createEl('p', { cls: 'atgc-about-text' });
        aboutText.createSpan({ text: 'A side project by ' });
        const brand = aboutText.createEl('a', {
            text: 'Meetzy',
            cls:  'atgc-brand',
            href: 'https://meetzy.ai',
        });
        brand.setAttr('target', '_blank');
        brand.setAttr('rel',    'noopener');
        aboutText.createSpan({ text: ' — an AI-native platform for marketing and sales teams.' });
    }

    // ── Footer ────────────────────────────────────────────────

    private renderFooter(el: HTMLElement): void {
        const footer = el.createDiv({ cls: 'atgc-footer' });
        const line = footer.createEl('p', { cls: 'atgc-footer-line' });
        line.createSpan({ text: 'A side project by ' });
        const brand = line.createEl('a', {
            text: 'Meetzy Corp FZCO',
            cls:  'atgc-brand',
            href: 'https://meetzy.ai',
        });
        brand.setAttr('target', '_blank');
        brand.setAttr('rel',    'noopener');
        line.createSpan({ text: '.' });
    }

    // ── General ───────────────────────────────────────────────

    private renderGeneral(el: HTMLElement): void {
        new Setting(el).setName('General').setHeading();

        new Setting(el)
            .setName('Enable plugin')
            .setDesc('Toggle automatic tag coloring on or off. Turning it off removes every color group this plugin created from the graph view.')
            .addToggle(t => t
                .setValue(this.plugin.settings.enabled)
                .onChange(async val => {
                    this.plugin.settings.enabled = val;
                    await this.plugin.saveSettings();
                    if (val) {
                        void this.plugin.fullScanAndApply();
                    } else {
                        await this.plugin.graphIntegration.clearManagedGroups(this.plugin.settings.managedQueries ?? []);
                        this.plugin.settings.managedQueries = [];
                        await this.plugin.saveSettings();
                        this.plugin.graphIntegration.removeAllLegends();
                    }
                }));

        new Setting(el)
            .setName('Auto-refresh')
            .setDesc('Re-scan and re-apply colors automatically when tags change.')
            .addToggle(t => t
                .setValue(this.plugin.settings.autoRefresh)
                .onChange(async val => {
                    this.plugin.settings.autoRefresh = val;
                    await this.plugin.saveSettings();
                }));
    }

    // ── Scan actions ──────────────────────────────────────────

    private renderScan(el: HTMLElement): void {
        new Setting(el).setName('Tag scanning').setHeading();

        new Setting(el)
            .setName('Scan vault now')
            .setDesc('Immediately scan all notes and apply colors to the graph view.')
            .addButton(b => b
                .setButtonText('Scan vault now')
                .setCta()
                .onClick(async () => {
                    await this.plugin.fullScanAndApply();
                    new Notice('ATGC: Vault scanned and colors applied.');
                    this.display();
                }));

        new Setting(el)
            .setName('Regenerate all colors')
            .setDesc('Re-generate colors for all unlocked tags (locked colors are preserved).')
            .addButton(b => b
                .setButtonText('Regenerate all colors')
                .onClick(async () => {
                    await this.plugin.regenerateAllColors();
                    this.display();
                }));

        new Setting(el)
            .setName('Reset all colors')
            .setDesc('Delete every saved color and start from scratch.')
            .addButton(b => b
                .setButtonText('Reset all colors')
                .setWarning()
                .onClick(async () => {
                    this.plugin.settings.tagColors   = {};
                    this.plugin.settings.lockedColors = {};
                    await this.plugin.saveSettings();
                    await this.plugin.fullScanAndApply();
                    new Notice('ATGC: All colors reset.');
                    this.display();
                }));

        new Setting(el)
            .setName('Ignore single-use tags')
            .setDesc('Do not assign a color to tags that appear in only one note.')
            .addToggle(t => t
                .setValue(this.plugin.settings.ignoreSingleUseTags)
                .onChange(async val => {
                    this.plugin.settings.ignoreSingleUseTags = val;
                    await this.plugin.saveSettings();
                    await this.plugin.fullScanAndApply();
                }));

        new Setting(el)
            .setName('Excluded tags')
            .setDesc('Comma-separated tags to never color, e.g. #daily, #template')
            .addText(t => t
                .setPlaceholder('#daily, #template, #archived')
                .setValue(this.plugin.settings.excludedTags.join(', '))
                .onChange(async val => {
                    this.plugin.settings.excludedTags = val
                        .split(',')
                        .map(s => s.trim().toLowerCase())
                        .filter(s => s.length > 0)
                        .map(s => s.startsWith('#') ? s : `#${s}`);
                    await this.plugin.saveSettings();
                    this.scheduleRescan();
                }));
    }

    // ── Colour generation settings ────────────────────────────

    private renderColors(el: HTMLElement): void {
        new Setting(el).setName('Color generation').setHeading();

        new Setting(el)
            .setName('Color palette')
            .setDesc('Choose the source palette for tag color assignment.')
            .addDropdown(d => d
                .addOption('modern',        'Modern')
                .addOption('pastel',        'Pastel')
                .addOption('high-contrast', 'High Contrast')
                .addOption('dark-optimized','Dark Mode Optimised')
                .addOption('colorblind',    'Colorblind-Friendly (Wong 2011)')
                .addOption('hsl',           'HSL Generated (golden-angle)')
                .setValue(this.plugin.settings.palette)
                .onChange(async val => {
                    this.plugin.settings.palette = val as PaletteType;
                    await this.plugin.saveSettings();
                    await this.plugin.regenerateAllColors();
                    this.display(); // refresh to show/hide HSL sliders
                }));

        if (this.plugin.settings.palette === 'hsl') {
            new Setting(el)
                .setName('Saturation')
                .setDesc('Color saturation for the HSL palette (0 = grey, 100 = vivid).')
                .addSlider(s => s
                    .setLimits(0, 100, 5)
                    .setValue(this.plugin.settings.saturation)
                    .setDynamicTooltip()
                    .onChange(async val => {
                        this.plugin.settings.saturation = val;
                        await this.plugin.saveSettings();
                        if (this.applyTimer) clearTimeout(this.applyTimer);
                        this.applyTimer = setTimeout(() => { void this.plugin.regenerateAllColors(); }, 200);
                    }));

            new Setting(el)
                .setName('Lightness')
                .setDesc('Color lightness for the HSL palette (0 = black, 100 = white).')
                .addSlider(s => s
                    .setLimits(0, 100, 5)
                    .setValue(this.plugin.settings.lightness)
                    .setDynamicTooltip()
                    .onChange(async val => {
                        this.plugin.settings.lightness = val;
                        await this.plugin.saveSettings();
                        if (this.applyTimer) clearTimeout(this.applyTimer);
                        this.applyTimer = setTimeout(() => { void this.plugin.regenerateAllColors(); }, 200);
                    }));
        }

        new Setting(el)
            .setName('Color mode')
            .setDesc('Determines which tag wins when a note has multiple tags.')
            .addDropdown(d => d
                .addOption('primary',  'Primary tag — first tag in the note wins')
                .addOption('priority', 'Priority tag — user-defined priority order')
                .addOption('multi',    'Multi-tag — falls back to primary (graph view limitation)')
                .setValue(this.plugin.settings.colorMode)
                .onChange(async val => {
                    this.plugin.settings.colorMode = val as ColorMode;
                    await this.plugin.saveSettings();
                    await this.plugin.applyCurrentColors();
                    this.display();
                }));

        if (this.plugin.settings.colorMode === 'priority') {
            new Setting(el)
                .setName('Priority tag order')
                .setDesc('Comma-separated tags, highest priority first.  The color of the first matching tag is used.')
                .addTextArea(ta => {
                    ta.setPlaceholder('#project, #client, #meeting')
                      .setValue(this.plugin.settings.priorityTags.join(', '));
                    ta.inputEl.rows = 3;
                    ta.onChange(async val => {
                        this.plugin.settings.priorityTags = val
                            .split(',')
                            .map(s => s.trim().toLowerCase())
                            .filter(s => s.length > 0)
                            .map(s => s.startsWith('#') ? s : `#${s}`);
                        await this.plugin.saveSettings();
                        this.scheduleApply();
                    });
                });
        }

        new Setting(el)
            .setName('Subtag mode')
            .setDesc('How to color hierarchical tags like #project/alpha.')
            .addDropdown(d => d
                .addOption('separate', 'Separate — each subtag gets its own color')
                .addOption('inherit',  'Parent inheritance — subtags inherit parent color with lightness variation')
                .setValue(this.plugin.settings.subtagMode)
                .onChange(async val => {
                    this.plugin.settings.subtagMode = val as SubtagMode;
                    await this.plugin.saveSettings();
                    await this.plugin.regenerateAllColors();
                }));

        // ── Smart tag blending ─────────────────────────────────
        new Setting(el).setName('Smart tag blending').setHeading();

        new Setting(el)
            .setName('Enable smart blending')
            .setDesc('Each note gets its own color blended from all its tags: primary tag color, subtly shifted toward secondary tags, with fine lightness variation per unique tag combo. Notes with identical tag sets get identical colors.')
            .addToggle(t => t
                .setValue(this.plugin.settings.blendTagsEnabled)
                .onChange(async val => {
                    this.plugin.settings.blendTagsEnabled = val;
                    await this.plugin.saveSettings();
                    await this.plugin.applyCurrentColors();
                    this.display();
                }));

        if (this.plugin.settings.blendTagsEnabled) {
            new Setting(el)
                .setName('Monochrome mode')
                .setDesc('Force every note to a shade of a single chosen color. Different tag combos still get distinct lightness/saturation variations, but the hue stays fixed.')
                .addToggle(t => t
                    .setValue(this.plugin.settings.blendMonochromeEnabled)
                    .onChange(async val => {
                        this.plugin.settings.blendMonochromeEnabled = val;
                        await this.plugin.saveSettings();
                        await this.plugin.applyCurrentColors();
                    }));

            new Setting(el)
                .setName('Monochrome base color')
                .setDesc('Base hue used when monochrome mode is on.')
                .then(s => {
                    const input = s.controlEl.createEl('input') as HTMLInputElement;
                    input.type  = 'color';
                    input.value = this.plugin.settings.blendMonochromeHue;
                    input.addClass('atgc-color-swatch');
                    input.addEventListener('input', async () => {
                        this.plugin.settings.blendMonochromeHue = input.value;
                        await this.plugin.saveSettings();
                        if (this.plugin.settings.blendMonochromeEnabled) {
                            await this.plugin.applyCurrentColors();
                        }
                    });
                });
        }

        // ── Heat coloring ──────────────────────────────────────
        new Setting(el).setName('Heat coloring by connections').setHeading();

        new Setting(el)
            .setName('Enable heat coloring')
            .setDesc('Color nodes from cold (few links) to hot (many links). Heat colors are placed first in the graph groups, so they override tag colors.')
            .addToggle(t => t
                .setValue(this.plugin.settings.heatColoringEnabled)
                .onChange(async val => {
                    this.plugin.settings.heatColoringEnabled = val;
                    await this.plugin.saveSettings();
                    await this.plugin.applyCurrentColors();
                    this.display();
                }));

        if (this.plugin.settings.heatColoringEnabled) {
            new Setting(el)
                .setName('Cold color')
                .setDesc('Color for nodes with the fewest connections.')
                .then(s => {
                    const input = s.controlEl.createEl('input') as HTMLInputElement;
                    input.type  = 'color';
                    input.value = this.plugin.settings.heatColdColor;
                    input.addClass('atgc-color-swatch');
                    input.addEventListener('input', async () => {
                        this.plugin.settings.heatColdColor = input.value;
                        await this.plugin.saveSettings();
                        await this.plugin.applyCurrentColors();
                    });
                });

            new Setting(el)
                .setName('Hot color')
                .setDesc('Color for nodes with the most connections.')
                .then(s => {
                    const input = s.controlEl.createEl('input') as HTMLInputElement;
                    input.type  = 'color';
                    input.value = this.plugin.settings.heatHotColor;
                    input.addClass('atgc-color-swatch');
                    input.addEventListener('input', async () => {
                        this.plugin.settings.heatHotColor = input.value;
                        await this.plugin.saveSettings();
                        await this.plugin.applyCurrentColors();
                    });
                });
        }
    }

    // ── Display ───────────────────────────────────────────────

    private renderDisplay(el: HTMLElement): void {
        new Setting(el).setName('Display').setHeading();

        new Setting(el)
            .setName('Show legend in graph view')
            .setDesc('Overlay a color legend on every graph view pane.')
            .addToggle(t => t
                .setValue(this.plugin.settings.showLegend)
                .onChange(async val => {
                    this.plugin.settings.showLegend = val;
                    await this.plugin.saveSettings();
                    this.plugin.updateLegends();
                }));

        new Setting(el)
            .setName('Legend visible')
            .setDesc('Quickly hide/show the legend without disabling it.')
            .addToggle(t => t
                .setValue(this.plugin.settings.legendVisible)
                .onChange(async val => {
                    this.plugin.settings.legendVisible = val;
                    await this.plugin.saveSettings();
                    this.plugin.updateLegends();
                }));
    }

    // ── Per-tag colour list ───────────────────────────────────

    private renderTagList(el: HTMLElement): void {
        new Setting(el).setName('Tag colors').setHeading();

        const lastScan = this.plugin.settings.lastScanTime;
        if (lastScan > 0) {
            el.createEl('p', {
                cls:  'atgc-last-scan',
                text: `Last scan: ${new Date(lastScan).toLocaleString()}`,
            });
        }

        const tagCount = Object.keys(this.plugin.settings.tagColors).length;
        el.createEl('p', {
            cls:  'atgc-last-scan',
            text: `${tagCount} tag${tagCount !== 1 ? 's' : ''} tracked.`,
        });

        // Search field
        const searchWrap = el.createDiv({ cls: 'atgc-search-container' });
        const searchEl   = searchWrap.createEl('input', { cls: 'atgc-search-input' }) as HTMLInputElement;
        searchEl.type        = 'text';
        searchEl.placeholder = 'Search tags…';

        // Tag list
        const listWrap = el.createDiv({ cls: 'atgc-tag-list-container' });
        this.populateTagList(listWrap, '');

        searchEl.addEventListener('input', () => {
            this.populateTagList(listWrap, searchEl.value);
        });
    }

    private populateTagList(container: HTMLElement, filter: string): void {
        container.empty();

        const { tagColors, lockedColors } = this.plugin.settings;
        const counts  = this.plugin.tagNoteCounts;
        const filterL = filter.toLowerCase();

        const entries = Object.entries(tagColors)
            .filter(([tag]) => !filterL || tag.toLowerCase().includes(filterL))
            .sort(([, , ca = counts.get('') ?? 0], [, , cb = counts.get('') ?? 0]) =>
                (counts.get('') ?? 0) - (counts.get('') ?? 0))  // placeholder, replaced below
            .sort(([a], [b]) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0));

        if (entries.length === 0) {
            container.createEl('p', {
                cls:  'atgc-no-tags',
                text: filter
                    ? 'No tags match your search.'
                    : 'No tags found. Click "Scan vault now" above.',
            });
            return;
        }

        for (const [tag, color] of entries) {
            const row = container.createDiv({ cls: 'atgc-tag-row' });

            // Colour preview dot — reflects the actual mode (blend/monochrome)
            const displayColor = this.plugin.graphIntegration.getDisplayColorForTag(tag, color);
            const dot = row.createSpan({ cls: 'atgc-tag-dot' });
            dot.style.backgroundColor = displayColor;

            // Tag name
            row.createSpan({ cls: 'atgc-tag-name', text: tag });

            // Note count
            row.createSpan({
                cls:  'atgc-tag-count',
                text: `${counts.get(tag) ?? 0} notes`,
            });

            // Native colour picker — shows the on-graph colour (mode-aware).
            // Editing it updates the tag's base color; the preview + graph
            // then reflect the new value through the current mode.
            const picker = row.createEl('input', { cls: 'atgc-color-picker' }) as HTMLInputElement;
            picker.type  = 'color';
            picker.value = displayColor;
            picker.addEventListener('input', async () => {
                const newBase = picker.value;
                this.plugin.settings.tagColors[tag] = newBase;
                const newDisplay = this.plugin.graphIntegration.getDisplayColorForTag(tag, newBase);
                dot.style.backgroundColor = newDisplay;
                await this.plugin.saveSettings();
                await this.plugin.applyCurrentColors();
            });

            // Lock / unlock button
            const locked = lockedColors[tag] ?? false;
            const lockBtn = row.createEl('button', { cls: 'atgc-lock-btn' });
            lockBtn.textContent = locked ? '🔒' : '🔓';
            lockBtn.title       = locked
                ? 'Locked – click to allow auto-regeneration'
                : 'Unlocked – click to lock this colour';
            lockBtn.addEventListener('click', async () => {
                const nowLocked = !(this.plugin.settings.lockedColors[tag] ?? false);
                this.plugin.settings.lockedColors[tag] = nowLocked;
                lockBtn.textContent = nowLocked ? '🔒' : '🔓';
                lockBtn.title       = nowLocked
                    ? 'Locked – click to allow auto-regeneration'
                    : 'Unlocked – click to lock this colour';
                await this.plugin.saveSettings();
            });

            // Reset single tag
            const resetBtn = row.createEl('button', { cls: 'atgc-reset-btn' });
            resetBtn.textContent = '↺';
            resetBtn.title       = "Reset this tag\u2019s color";
            resetBtn.addEventListener('click', async () => {
                delete this.plugin.settings.tagColors[tag];
                delete this.plugin.settings.lockedColors[tag];
                await this.plugin.saveSettings();
                await this.plugin.fullScanAndApply();
                this.display();
            });
        }
    }
}
