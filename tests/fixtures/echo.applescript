-- echo.applescript — tiny fixture for testing osascript invocation.
-- Returns "ok:<count>:<first-arg-or-empty>" so the test can assert args were forwarded.
on run argv
	set n to (count of argv) as string
	if (count of argv) is 0 then
		return "ok:0:"
	end if
	set arg1 to (item 1 of argv) as string
	return "ok:" & n & ":" & arg1
end run
