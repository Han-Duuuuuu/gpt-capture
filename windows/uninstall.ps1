$ErrorActionPreference = 'Stop'
$registryPath = 'HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\com.gpt_capture.assistant'
if (Test-Path -LiteralPath $registryPath) { Remove-Item -LiteralPath $registryPath -Recurse }
$installRoot = Join-Path $env:LOCALAPPDATA 'GPTCaptureAssistant'
foreach ($name in @('gpt-capture-host.exe', 'host.json')) {
    $file = Join-Path $installRoot $name
    if (Test-Path -LiteralPath $file) { Remove-Item -LiteralPath $file }
}
if ((Test-Path -LiteralPath $installRoot) -and -not (Get-ChildItem -LiteralPath $installRoot -Force)) {
    Remove-Item -LiteralPath $installRoot
}
Write-Host 'Screenshot assistant removed. The Edge extension can be removed separately.'
