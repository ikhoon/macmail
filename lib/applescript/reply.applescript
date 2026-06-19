-- reply.applescript — reply (or reply-all) to a message
-- usage: osascript lib/applescript/reply.applescript <ACCOUNT> <MAILBOX> <ID> <BODY> [ALL] [DRAFT]
--   ALL   : "1" to reply-all (default: "0")
--   DRAFT : "1" to save as draft (persists to Drafts) instead of sending (default: "0")
-- WRITE OPERATION — caller (the dispatcher) is responsible for confirmation.

on run argv
	if (count of argv) < 4 then error "usage: reply <ACCOUNT> <MAILBOX> <ID> <BODY> [ALL] [DRAFT]"
	set acct to item 1 of argv
	set mbName to item 2 of argv
	set msgId to (item 3 of argv) as integer
	set bodyText to item 4 of argv
	set replyAll to false
	set isDraft to false
	if (count of argv) ≥ 5 then set replyAll to (item 5 of argv) is "1"
	if (count of argv) ≥ 6 then set isDraft to (item 6 of argv) is "1"

	tell application "Mail"
		with timeout of 60 seconds
			set m to first message of mailbox mbName of account acct whose id is msgId
			if replyAll then
				set replyMsg to reply m with opening window with reply to all
			else
				set replyMsg to reply m with opening window
			end if
			-- Give Mail.app a moment to inject the auto-quoted original + signature
			-- before we read `content`; otherwise the prepend can land on an empty buffer.
			delay 0.5
			tell replyMsg
				set content to bodyText & linefeed & linefeed & content
			end tell
			if isDraft then
				save replyMsg
			else
				send replyMsg
			end if
		end timeout
	end tell
	return "ok"
end run
