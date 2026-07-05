# vhs tape for the macmail CLI demo gif (assets/demo-cli.gif).
# Regenerate:  PATH="$PWD/demo/bin:$PATH" vhs demo/demo.tape
# Uses demo/bin/macmail — a mock that prints fictional output and never touches
# ~/Library/Mail — so the gif is safe to publish.
Output "assets/demo-cli.gif"

Set Shell "bash"
Set FontSize 16
Set Width 1280
Set Height 640
Set Padding 24
Set Theme "Dracula"
Set TypingSpeed 45ms

Hide
Type "PS1='$ '; clear"
Enter
Sleep 300ms
Show

Sleep 600ms
Type "macmail triage --max 4"
Enter
Sleep 1.8s

Type "macmail search '초대장'"
Enter
Sleep 1.8s

Type "macmail read 2231310 --headers"
Enter
Sleep 2.2s

Type "macmail mark 2232339 read --dry-run"
Enter
Sleep 2s
