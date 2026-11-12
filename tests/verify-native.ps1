# Real Windows compile + native-messaging protocol + installer verification.
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
& (Join-Path $projectRoot 'windows/install.ps1')
if ($LASTEXITCODE -ne 0) { throw 'Installer failed.' }
$installRoot = Join-Path $env:LOCALAPPDATA 'GPTCaptureAssistant'
try {
    $manifestPath = Join-Path $installRoot 'host.json'
    $registered = (Get-Item 'HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\com.gpt_capture.assistant').GetValue('')
    if ($registered -ne $manifestPath) { throw 'Native host registry mismatch.' }
    # Node is required by tests only, not by the installed Windows helper.
    # Its binary pipes avoid the BOM written by .NET Framework StreamWriter.
    & node (Join-Path $PSScriptRoot 'verify-native.mjs') $manifestPath
    if ($LASTEXITCODE -ne 0) { throw 'Native protocol verification failed.' }
} finally {
    & (Join-Path $projectRoot 'windows/uninstall.ps1')
}
