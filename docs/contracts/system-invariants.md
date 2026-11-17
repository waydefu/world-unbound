# Runtime System Invariants (initial contract)

**Status: proposed, not validated by running game tests.**

1. ECS component storage must remain valid for the duration of each iteration.
2. Physics stepping must use an explicit, bounded time-step contract and deterministic ordering where specified.
3. Renderer must not mutate ECS physics state implicitly during draw submission.
4. Asset streaming may delay visibility but must not invalidate already committed object handles.
5. JS↔Wasm data ownership, freed memory and error paths are explicitly tested before release.
6. WGSL binding layouts and shader feature requirements are versioned and validated against supported devices.
7. Changes to scheduling order or serialization format require cross-module integration tests, not only typechecks.

Define test fixtures and concrete thresholds when runtime modules first appear.
