Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class ClipWin {
    [DllImport("user32.dll")]
    public static extern int GetClipboardSequenceNumber();
}
"@
[ClipWin]::GetClipboardSequenceNumber()
