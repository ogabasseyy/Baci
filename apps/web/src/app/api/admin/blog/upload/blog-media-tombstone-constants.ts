// Staged blog-media deletions: the DELETE route tombstones paths
// instead of removing them, saves resurrect tombstones their payload
// references, and a scheduled sweep removes only tombstones older
// than the grace window that no persisted post references.
export const BLOG_MEDIA_TOMBSTONE_TABLE = 'blog_media_delete_tombstones';

export const BLOG_MEDIA_TOMBSTONE_GRACE_MS = 60 * 60 * 1000;

// Active drafts heartbeat this often so an editor session open past
// the grace window keeps its staged uploads leased: three beats per
// grace period against a ten-minute cron leaves no gap.
export const BLOG_MEDIA_TOMBSTONE_HEARTBEAT_MS = 20 * 60 * 1000;

export const BLOG_MEDIA_TOMBSTONE_SWEEP_LIMIT = 500;
