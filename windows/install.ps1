# Run with the Windows PowerShell included in Windows 10/11; no administrator required.
$ErrorActionPreference = 'Stop'
try {
    $projectRoot = Split-Path -Parent $PSScriptRoot
    $extension = Get-Content -LiteralPath (Join-Path $projectRoot 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    if (-not $extension.key) { throw 'Missing extension key. Download the full, current project ZIP.' }
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try { $hash = $sha.ComputeHash([Convert]::FromBase64String($extension.key)) } finally { $sha.Dispose() }
    $extensionId = -join (0..15 | ForEach-Object {
        [char](97 + ($hash[$_] -shr 4)); [char](97 + ($hash[$_] -band 15))
    })
    if ($extensionId -notmatch '^[a-p]{32}$') { throw 'Invalid extension ID.' }
    $installRoot = Join-Path $env:LOCALAPPDATA 'GPTCaptureAssistant'
    New-Item -ItemType Directory -Path $installRoot -Force | Out-Null
    # Compile into a fresh file so a failed build never replaces an installed host.
    $buildPath = Join-Path $installRoot ('host-' + [guid]::NewGuid().ToString('N') + '.exe')
    $exePath = Join-Path $installRoot 'gpt-capture-host.exe'
    Add-Type -Path (Join-Path $PSScriptRoot 'native-host.cs') -OutputAssembly $buildPath -OutputType ConsoleApplication -ReferencedAssemblies 'System.dll','System.Core.dll','System.Drawing.dll','System.Runtime.Serialization.dll','System.Xml.dll'
    Move-Item -LiteralPath $buildPath -Destination $exePath -Force
    $hostManifest = @{
        name = 'com.gpt_capture.assistant'
        description = 'GPT Capture Assistant - on-demand in-memory Windows screenshots'
        path = $exePath
        type = 'stdio'
        allowed_origins = @('chrome-extension://' + $extensionId + '/')
    }
    $manifestPath = Join-Path $installRoot 'host.json'
    [System.IO.File]::WriteAllText($manifestPath, ($hostManifest | ConvertTo-Json -Depth 4), (New-Object System.Text.UTF8Encoding($false)))
    $registryPath = 'HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\com.gpt_capture.assistant'
    New-Item -Path $registryPath -Force | Out-Null
    Set-Item -Path $registryPath -Value $manifestPath
    Write-Host ''
    Write-Host 'Installed successfully.' -ForegroundColor Green
    Write-Host ('Extension ID: ' + $extensionId)
    Write-Host 'Load the NEW extension folder in Edge, then refresh ChatGPT.'
    Write-Host 'For an upgrade from 1.0, remove the old extension first.'
    exit 0
} catch {
    Write-Host ('Installation failed: ' + $_.Exception.Message) -ForegroundColor Red
    exit 1
}
