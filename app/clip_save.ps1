param([string]$dest)
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$img = [System.Windows.Forms.Clipboard]::GetImage()
if ($img) {
    $img.Save($dest, [System.Drawing.Imaging.ImageFormat]::Png)
    Write-Output "OK"
} else {
    Write-Output "NOIMAGE"
}
