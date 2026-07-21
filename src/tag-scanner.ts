// ─────────────────────────────────────────────────────────────
//  Auto Tag Graph Colors – tag scanning via MetadataCache
// ─────────────────────────────────────────────────────────────

import { App, TFile } from 'obsidian';

export class TagScanner {
    private app: App;

    constructor(app: App) {
        this.app = app;
    }

    /**
     * Scan every Markdown file in the vault and return a map of
     * normalised-tag → note-count.
     *
     * Uses MetadataCache exclusively — no disk reads.
     */
    scanAllTags(): Map<string, number> {
        const counts = new Map<string, number>();
        for (const file of this.app.vault.getMarkdownFiles()) {
            for (const tag of this.getTagsForFile(file)) {
                counts.set(tag, (counts.get(tag) ?? 0) + 1);
            }
        }
        return counts;
    }

    /**
     * Return the deduplicated, normalised tag list for a single file.
     * Sources: frontmatter `tags` / `tag` field, and inline #tags.
     */
    getTagsForFile(file: TFile): string[] {
        const cache = this.app.metadataCache.getFileCache(file);
        if (!cache) return [];

        const tags = new Set<string>();

        // ── Frontmatter: `tags` (array or comma-string) ──────
        const fmTags = cache.frontmatter?.['tags'];
        if (Array.isArray(fmTags)) {
            for (const t of fmTags) {
                if (typeof t === 'string' && t.trim()) {
                    tags.add(this.normalise(t.trim()));
                }
            }
        } else if (typeof fmTags === 'string') {
            for (const t of fmTags.split(/[\s,]+/)) {
                if (t.trim()) tags.add(this.normalise(t.trim()));
            }
        }

        // ── Frontmatter: `tag` (singular) ────────────────────
        const fmTag = cache.frontmatter?.['tag'];
        if (typeof fmTag === 'string' && fmTag.trim()) {
            tags.add(this.normalise(fmTag.trim()));
        }

        // ── Inline tags cached by Obsidian ───────────────────
        if (cache.tags) {
            for (const entry of cache.tags) {
                tags.add(this.normalise(entry.tag));
            }
        }

        return Array.from(tags).filter(t => t.length > 1); // skip bare '#'
    }

    /** Normalise to lowercase with a leading # */
    normalise(raw: string): string {
        const stripped = raw.startsWith('#') ? raw : `#${raw}`;
        return stripped.toLowerCase();
    }

    /** filePath → deduplicated normalised tag list, for every markdown file that has tags. */
    getAllFileTags(): Map<string, string[]> {
        const out = new Map<string, string[]>();
        for (const file of this.app.vault.getMarkdownFiles()) {
            const tags = this.getTagsForFile(file);
            if (tags.length > 0) out.set(file.path, tags);
        }
        return out;
    }
}
