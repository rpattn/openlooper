# CODEX.md

> This is a pre-production experimental prototype.

The sole purpose of this repository is to determine whether this route-planning product is enjoyable and useful enough to continue building.

## Non-negotiable prototype rules

- NO AUTOMATED TESTS or test infrastructure.
- NO CI/CD or production infrastructure.
- NO BACKEND, DATABASE, AUTHENTICATION, API VERSIONING, OR COMPATIBILITY WORK.
- NO ARCHITECTURE FOR HYPOTHETICAL FUTURE REQUIREMENTS.

When fixing a bug: reproduce it manually, implement the simplest fix, run typecheck/lint/build, and manually verify it.

Keep product logic readable, MapLibre behavior web-specific, raw Valhalla structures inside routing, and never turn incomplete OSM data into confident safety claims.
