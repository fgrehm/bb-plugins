Rate Your Chat asks for feedback on a chat once you archive it, then keeps that feedback beside the model and reasoning level you used, so you can compare how different setups did. Nothing is sent anywhere: ratings live in the plugin's own database on your BB server, and only a local export leaves the machine.

## What you get

- An optional rating dialog after an archive, skippable and never blocking the archive itself. Usefulness runs from 1 to 5, with one or more use cases and an optional note.
- Recorded model and reasoning variations captured when you save, including provider fallbacks, plus a count of how often each combination was used.
- A **Chat ratings** page in the sidebar for reading, editing, deleting, and exporting feedback, one editable rating per chat and shared across BB clients.
- Agent-drafted retros that wait above the list for you to confirm or discard; confirming one becomes the chat's rating.

## Requirements and limits

No account, API key, or outside service. Ratings and prompts stay in the plugin's SQLite store on the BB server, and a prompt survives a plugin reload. Capture reflects the history BB recorded, so missing legacy metadata is marked partial and provider-internal routing is not visible. Archives made before installation, or while the plugin was disabled, are not backfilled. A retro is only drafted when you ask the agent for one.
