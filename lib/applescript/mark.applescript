-- mark.applescript — mark a message as read or unread
-- usage: osascript lib/applescript/mark.applescript <ACCOUNT> <MAILBOX> <ID> <STATE>
--   STATE = "read" | "unread"
-- WRITE OPERATION — caller (the dispatcher) is responsible for confirmation.

on run argv
	if (count of argv) < 4 then error "usage: mark <ACCOUNT> <MAILBOX> <ID> <read|unread>"
	set acct to item 1 of argv
	set mbName to item 2 of argv
	set msgId to (item 3 of argv) as integer
	set state to item 4 of argv

	set newStatus to true
	if state is "unread" then
		set newStatus to false
	else if state is not "read" then
		error "STATE must be 'read' or 'unread'"
	end if

	tell application "Mail"
		with timeout of 60 seconds
			set m to first message of mailbox mbName of account acct whose id is msgId
			set read status of m to newStatus
		end timeout
	end tell
	return "ok"
end run
