// ─────────────────────────────────────────────────────────────
//  Auto Tag Graph Colors – main plugin entry point
// ─────────────────────────────────────────────────────────────

import { Notice, Plugin, TFile, WorkspaceLeaf } from 'obsidian';
import { AutoTagGraphSettings, DEFAULT_SETTINGS } from './types';
import { TagScanner }                             from './tag-scanner';
import { ColorManager }                           from './color-manager';
import { GraphIntegration }                       from './graph-integration';
import { AutoTagGraphSettingTab }                 from './settings';

export default class AutoTagGraphColorsPlugin extends Plugin {
    settings!:       AutoTagGraphSettings;
    tagNoteCounts:   Map<string, number> = new Map();

    // These are always initialised in onload before any other code runs
    tagScanner!:       TagScanner;
    colorManager!:     ColorManager;
    graphIntegration!: GraphIntegration;

    private scanDebounce:    number | null = null;
    private readonly SCAN_DELAY = 2000; // ms

    // ── Plugin lifecycle ──────────────────────────────────────

    async onload(): Promise<void> {
        await this.loadSettings();

        this.tagScanner       = new TagScanner(this.app);
        this.colorManager     = new ColorManager(this.settings);
        this.graphIntegration = new GraphIntegration(this.app, this.settings);

        this.addSettingTab(new AutoTagGraphSettingTab(this.app, this));

        // ── Commands ─────────────────────────────────────────
        this.addCommand({
            id:       'atgc-scan-vault',
            name:     'Scan vault and apply tag colors',
            callback: () => { void this.fullScanAndApply(); },
        });

        this.addCommand({
            id:       'atgc-regenerate-colors',
            name:     'Regenerate all tag colors',
            callback: () => { void this.regenerateAllColors(); },
        });

        this.addCommand({
            id:       'atgc-toggle-legend',
            name:     'Toggle tag color legend',
            callback: () => { void this.toggleLegend(); },
        });

        // Wait for workspace + cache to be ready before doing anything
        this.app.workspace.onLayoutReady(() => { void this.initialize(); });
    }

    onunload(): void {
        if (this.scanDebounce) {
            window.clearTimeout(this.scanDebounce);
            this.scanDebounce = null;
        }
        // Remove every color-group this plugin created so the graph goes back
        // to Obsidian's default (or whatever the user manually added).
        void this.graphIntegration?.clearManagedGroups(this.settings.managedQueries ?? []);
        this.graphIntegration?.removeAllLegends();
    }

    // ── Initialisation ────────────────────────────────────────

    private async initialize(): Promise<void> {
        // MetadataCache fully resolved (initial vault load)
        this.registerEvent(
            this.app.metadataCache.on('resolved', () => {
                if (this.settings.enabled && this.settings.autoRefresh) {
                    this.scheduleScan();
                }
            }),
        );

        // Any file's metadata changed
        this.registerEvent(
            this.app.metadataCache.on('changed', _file => {
                if (this.settings.enabled && this.settings.autoRefresh) {
                    this.scheduleScan();
                }
            }),
        );

        // File deleted
        this.registerEvent(
            this.app.vault.on('delete', abstractFile => {
                if (
                    abstractFile instanceof TFile &&
                    abstractFile.extension === 'md' &&
                    this.settings.enabled &&
                    this.settings.autoRefresh
                ) {
                    this.scheduleScan();
                }
            }),
        );

        // New graph leaf opened → inject legend
        this.registerEvent(
            this.app.workspace.on('layout-change', () => {
                if (this.settings.showLegend) {
                    this.updateLegends();
                }
            }),
        );

        // Do the first full scan
        if (this.settings.enabled) {
            await this.fullScanAndApply();
        }
    }

    // ── Debounced scan scheduling ─────────────────────────────

    private scheduleScan(): void {
        if (this.scanDebounce) window.clearTimeout(this.scanDebounce);
        this.scanDebounce = window.setTimeout(() => {
            this.scanDebounce = null;
            void this.fullScanAndApply();
        }, this.SCAN_DELAY);
    }

    // ── Core operations ───────────────────────────────────────

    /**
     * Full vault scan → assign colours to new tags → write graph.json.
     * Safe to call multiple times; locked colours are never changed.
     */
    async fullScanAndApply(): Promise<void> {
        if (!this.settings.enabled) return;

        const counts = this.tagScanner.scanAllTags();
        this.tagNoteCounts = counts;

        const eligible = this.filterEligible(counts);
        let changed = false;

        for (const tag of eligible) {
            // Never overwrite a locked colour
            if (this.settings.lockedColors[tag]) continue;

            if (!this.settings.tagColors[tag]) {
                // Subtag inheritance mode
                if (this.settings.subtagMode === 'inherit') {
                    const parentKey = this.colorManager.getParentTag(tag);
                    if (parentKey) {
                        const parentWithHash = parentKey.startsWith('#') ? parentKey : `#${parentKey}`;
                        const parentColor    = this.settings.tagColors[parentWithHash];
                        if (parentColor) {
                            const depth = this.colorManager.getTagDepth(tag);
                            this.settings.tagColors[tag] = this.colorManager.generateChildColor(
                                parentColor,
                                depth,
                            );
                            changed = true;
                            continue;
                        }
                    }
                }

                // Normal colour generation
                const existing = Object.values(this.settings.tagColors);
                this.settings.tagColors[tag] =
                    this.colorManager.generateColorForTag(tag, existing);
                changed = true;
            }
        }

        if (changed) await this.saveSettings();

        await this.applyCurrentColors();

        this.settings.lastScanTime = Date.now();
        await this.saveSettings();
    }

    /** Apply the current tagColors map to the graph without rescanning. */
    async applyCurrentColors(): Promise<void> {
        const fileTags = this.settings.blendTagsEnabled
            ? this.tagScanner.getAllFileTags()
            : undefined;
        const managedQueries = await this.graphIntegration.applyColors(
            this.settings.tagColors,
            this.settings.priorityTags,
            this.settings.colorMode,
            this.settings.managedQueries,
            fileTags,
        );
        this.settings.managedQueries = managedQueries;
        await this.saveSettings();

        if (this.settings.showLegend) {
            this.updateLegends();
        }
    }

    private filterEligible(counts: Map<string, number>): string[] {
        return Array.from(counts.entries())
            .filter(([tag, count]) => {
                if (this.settings.excludedTags.includes(tag)) return false;
                if (this.settings.ignoreSingleUseTags && count <= 1) return false;
                return true;
            })
            .map(([tag]) => tag);
    }

    // ── Public commands (also called from settings tab) ───────

    async regenerateAllColors(): Promise<void> {
        for (const tag of Object.keys(this.settings.tagColors)) {
            if (!this.settings.lockedColors[tag]) {
                delete this.settings.tagColors[tag];
            }
        }
        await this.saveSettings();
        await this.fullScanAndApply();
        new Notice('Auto Tag Graph Colors: colors regenerated.');
    }

    async toggleLegend(): Promise<void> {
        this.settings.legendVisible = !this.settings.legendVisible;
        await this.saveSettings();
        this.updateLegends();
    }

    updateLegends(): void {
        this.app.workspace.getLeavesOfType('graph').forEach((leaf: WorkspaceLeaf) => {
            this.graphIntegration.updateLegend(
                leaf,
                this.settings.tagColors,
                this.tagNoteCounts,
                async (tag: string, newColor: string) => {
                    this.settings.tagColors[tag] = newColor;
                    await this.saveSettings();
                    await this.applyCurrentColors();
                },
                async (visible: boolean) => {
                    this.settings.legendVisible = visible;
                    await this.saveSettings();
                },
            );
        });
    }

    // ── Settings persistence ──────────────────────────────────

    async loadSettings(): Promise<void> {
        this.settings = Object.assign(
            {},
            DEFAULT_SETTINGS,
            await this.loadData() as Partial<AutoTagGraphSettings>,
        );
    }

    async saveSettings(): Promise<void> {
        await this.saveData(this.settings);
        this.colorManager?.updateSettings(this.settings);
        this.graphIntegration?.updateSettings(this.settings);
    }
}
