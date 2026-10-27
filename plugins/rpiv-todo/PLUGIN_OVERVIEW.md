RPIV Todo puts Pi's own to-do list above the thread's composer, using BB's native to-do card: an `N/M complete` header, a spinner on the active step, pending steps squared, and the list sorted in-progress first. The agent owns the list; you only read it.

BB draws that panel for Cursor `TodoWrite` and Claude `TaskCreate`/`TaskUpdate` from a field plugin UI cannot write. Pi's extension tool is named `todo` and is not on that list, so this plugin rebuilds the list from the thread's completed `todo` tool calls and renders it with the same chrome. It is read-only: it stores nothing on disk, writes nothing, and makes no network requests.

## Requirements and limits

Both halves are needed. Install `npm:@juicesharp/rpiv-todo` in Pi, then start a new session so the `todo` tool loads; without it the card never appears. The list is reconstructed from tool calls because BB does not persist the extension's own snapshot, so a failed tool call is skipped, and a thread longer than 20,000 events can lose its earliest tasks. The reducer mirrors `@juicesharp/rpiv-todo` 2.15.0, so both should be updated together.
