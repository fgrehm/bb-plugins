Chat Timestamps shows how long ago each message was sent or received, in BB's own message action strip. Hover or focus a message on a desktop, or look beside the message actions on a touch screen, for a relative time such as `5m ago`; hover the timestamp for the exact local date, time, and zone offset. It covers your messages, agent replies, and messages delivered from other threads.

It works by decorating BB's existing timeline rows, so the timestamp inherits the theme's muted text color and does not add another toolbar. Immediately after navigation, and every 30 seconds otherwise, the plugin reads the newest timeline page of the threads on screen through BB's public SDK, then fetches older pages only as older messages come into view. Nothing is written to disk, no thread data is modified, and no network requests are made.

## Requirements and limits

Requires BB 0.47 or newer. Because the timestamp is placed with BB's current timeline markup rather than a public message-action API, a BB markup change can move or hide it until the plugin is updated. Older pages are backfilled for the open thread, so in a split pane the other thread's oldest messages can stay unlabeled. Only conversation messages get a timestamp; tool rows and turn markers do not. Touch screens show timestamps at rest because there is no hover. Times use the browser's locale and local time zone.
