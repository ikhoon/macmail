-- send.applescript — compose and (optionally) send a new message
-- usage: osascript lib/applescript/send.applescript <TO> <SUBJECT> <BODY> [CC] [BCC] [DRAFT]
--   CC, BCC : comma-separated emails or empty string
--   DRAFT   : "1" to save as draft (persists to Drafts mailbox) instead of sending
--
-- For attachments and per-account sender selection, extend with additional args
-- (Mail.app supports both via AppleScript but this wrapper does not yet).
-- WRITE OPERATION — caller (the dispatcher) is responsible for confirmation.

on splitAddresses(str)
	set out to {}
	if str is "" then return out
	set AppleScript's text item delimiters to ","
	set parts to text items of str
	set AppleScript's text item delimiters to ""
	repeat with p in parts
		set trimmed to my trim(p as string)
		if trimmed is not "" then set end of out to trimmed
	end repeat
	return out
end splitAddresses

on trim(s)
	repeat while s starts with " "
		set s to text 2 thru -1 of s
	end repeat
	repeat while s ends with " "
		set s to text 1 thru -2 of s
	end repeat
	return s
end trim

on run argv
	if (count of argv) < 3 then error "usage: send <TO> <SUBJECT> <BODY> [CC] [BCC] [DRAFT]"
	set toStr to item 1 of argv
	set subj to item 2 of argv
	set body to item 3 of argv
	set ccStr to ""
	set bccStr to ""
	set isDraft to false
	if (count of argv) ≥ 4 then set ccStr to item 4 of argv
	if (count of argv) ≥ 5 then set bccStr to item 5 of argv
	if (count of argv) ≥ 6 then set isDraft to (item 6 of argv) is "1"

	tell application "Mail"
		with timeout of 60 seconds
			set newMsg to make new outgoing message with properties {subject:subj, content:body, visible:isDraft}
			tell newMsg
				repeat with addr in my splitAddresses(toStr)
					make new to recipient with properties {address:addr}
				end repeat
				repeat with addr in my splitAddresses(ccStr)
					make new cc recipient with properties {address:addr}
				end repeat
				repeat with addr in my splitAddresses(bccStr)
					make new bcc recipient with properties {address:addr}
				end repeat
			end tell
			if isDraft then
				-- Persist to Drafts so closing the window doesn't discard the message.
				save newMsg
			else
				send newMsg
			end if
		end timeout
	end tell
	return "ok"
end run
