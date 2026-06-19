// applescripts.ts — embed the write-op AppleScript bodies as text so the
// compiled binary is self-contained (no need to ship loose .applescript files).
//
// Bun's `with { type: 'text' }` import attribute lets us read the file contents
// at build time. The .applescript files still live under lib/applescript/ for
// hand-editing and human review.

import markSource from '../../lib/applescript/mark.applescript' with { type: 'text' };
import sendSource from '../../lib/applescript/send.applescript' with { type: 'text' };
import replySource from '../../lib/applescript/reply.applescript' with { type: 'text' };

export const MARK_APPLESCRIPT: string = markSource;
export const SEND_APPLESCRIPT: string = sendSource;
export const REPLY_APPLESCRIPT: string = replySource;
