# Nexus Companion — working notes for Claude

## Commits and changelog

When a commit changes anything a player could notice, end the commit message with a line:

    Changelog: <one plain sentence>

Write for players, no jargon, under 90 characters. Example: `Changelog: You can now set the radio strip opacity.`

Commits a player could not notice get no `Changelog` line.

The backend `/api/changelog` route reads `git log` at runtime and
surfaces any `Changelog:` trailer newer than the pinned rows in
`backend/data/changelog.json`. Rows without a trailer are developer-only.
