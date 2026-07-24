// The changelog viewer renders CryptoScanBot-ui/CHANGELOG.md directly (Vite ?raw),
// so the markdown file stays the single source of truth - editing it updates the
// in-app viewer and the "what's new" dot automatically, with no duplicated content.
import changelogRaw from '../../../../CHANGELOG.md?raw'

export interface ChangelogSection {
  label: string        // NEW | IMPROVED | FIX | TECH
  items: string[]      // raw bullet text (may contain **bold** and `code`)
}

export interface ChangelogVersion {
  version: string      // e.g. "v0.1.0"
  date: string         // e.g. "2026-07-21"
  sections: ChangelogSection[]
}

// Parse our fixed changelog shape: "## vX - DATE" -> "### SECTION" -> "- bullet".
export function parseChangelog(raw: string): ChangelogVersion[] {
  const versions: ChangelogVersion[] = []
  let version: ChangelogVersion | null = null
  let section: ChangelogSection | null = null

  for (const line of raw.split('\n')) {
    const vMatch = /^##\s+(\S+)\s+-\s+(.+?)\s*$/.exec(line)
    if (vMatch) {
      version = { version: vMatch[1] ?? '', date: vMatch[2] ?? '', sections: [] }
      versions.push(version)
      section = null
      continue
    }
    const sMatch = /^###\s+(.+?)\s*$/.exec(line)
    if (sMatch && version) {
      section = { label: sMatch[1] ?? '', items: [] }
      version.sections.push(section)
      continue
    }
    const bMatch = /^-\s+(.+?)\s*$/.exec(line)
    if (bMatch && section) {
      section.items.push(bMatch[1] ?? '')
    }
  }
  return versions
}

export const CHANGELOG_VERSIONS = parseChangelog(changelogRaw)
export const LATEST_VERSION = CHANGELOG_VERSIONS[0]?.version ?? ''

// "What's new" dot: unseen when the latest version differs from the last one the
// user opened the changelog on (persisted in localStorage).
const SEEN_KEY = 'csb.changelogSeen'

export function markChangelogSeen(): void {
  try { localStorage.setItem(SEEN_KEY, LATEST_VERSION) } catch { /* localStorage unavailable */ }
}

export function hasUnseenChangelog(): boolean {
  try { return localStorage.getItem(SEEN_KEY) !== LATEST_VERSION } catch { return false }
}
