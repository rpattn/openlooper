# CODEX.md

> This is a pre-production experimental prototype.

The sole purpose of this repository is to determine whether this route-planning product is enjoyable and useful enough to continue building.

## Non-negotiable prototype rules

- NO AUTOMATED TESTS or test infrastructure.
- NO CI/CD or production infrastructure.
- NO GENERAL APPLICATION BACKEND, AUTHENTICATION, OR API VERSIONING. The supported route-use layer has one purpose-built, local-only SQLite companion service; preserve its existing HTTP paths and do not generalize it.
- NO ARCHITECTURE FOR HYPOTHETICAL FUTURE REQUIREMENTS.

When fixing a bug: reproduce it manually, implement the simplest fix, run typecheck/lint/build, and manually verify it.

Keep product logic readable, MapLibre behavior web-specific, raw Valhalla structures inside routing, and never turn incomplete OSM data into confident safety claims.
