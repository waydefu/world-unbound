# Save and Serialization Contract

**Status: template; no save format has been released.**

Every persisted record must declare a schema version. Preserve representative fixtures from every supported released version. Migrations should be idempotent or reject repeated application safely.

For IndexedDB and LocalStorage:
- Backup or stage a validated copy before a destructive migration.
- Test migration from the oldest supported fixture to current schema.
- Verify rollback behavior explicitly; reverting JS code does not undo rewritten player data.
- Use expand-and-contract: first introduce readers able to handle old and new data, migrate, then remove old formats in a separate compatibility window.
- Changes that irreversibly delete data or cannot be rolled back are R3.
