# Architecture

This folder will contain architecture decisions and dependency diagrams for the TS + Rust/Wasm + WGSL game runtime.

The accepted architecture and module boundaries are recorded in [ADR-0001](../adr/0001-engine-architecture.md). Game milestone G0 (engine skeleton, authoritative terrain, telemetry) is implemented under `src/`; module boundaries are enforced by `scripts/audit.mjs`.

References: [system invariants](../contracts/system-invariants.md), [save schema](../contracts/save-schema.md).
