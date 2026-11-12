# Real Windows compile + native-messaging protocol + installer verification.
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
& (Join-Path $projectRoot 'windows/install.ps1')
if ($LASTEXITCODE -ne 0) { throw 'Installer failed.' }
$installRoot = Join-Path $env:LOCALAPPDATA 'GPTCaptureAssistant'
$hostConfig = Get-Content -LiteralPath (Join-Path $installRoot 'host.json') -Raw | ConvertFrom-Json
if ($hostConfig.allowed_origins.Count -ne 1 -or $hostConfig.allowed_origins[0] -notmatch '^chrome-extension://[a-p]{32}/$') { throw 'Invalid origin allowlist.' }
$registered = (Get-Item 'HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\com.gpt_capture.assistant').GetValue('')
if ($registered -ne (Join-Path $installRoot 'host.json')) { throw 'Native host registry mismatch.' }

$start = New-Object System.Diagnostics.ProcessStartInfo
$start.FileName = $hostConfig.path
$start.UseShellExecute = $false
$start.CreateNoWindow = $true
$start.RedirectStandardInput = $true
$start.RedirectStandardOutput = $true
$start.RedirectStandardError = $true
$start.StandardInputEncoding = New-Object System.Text.UTF8Encoding($false)
$process = [System.Diagnostics.Process]::Start($start)
function Read-Exact([System.IO.Stream]$stream, [int]$length) {
    $buffer = New-Object byte[] $length
    $offset = 0
    while ($offset -lt $length) {
        $read = $stream.Read($buffer, $offset, $length - $offset)
        if ($read -eq 0) { throw 'Truncated native output.' }
        $offset += $read
    }
    return ,$buffer
}
function Send-Request([string]$command) {
    $bytes = [Text.Encoding]::UTF8.GetBytes((@{command = $command} | ConvertTo-Json -Compress))
    $prefix = [BitConverter]::GetBytes([int]$bytes.Length)
    # Deliberately fragment the prefix and payload to exercise exact reads.
    $process.StandardInput.BaseStream.Write($prefix, 0, 2)
    $process.StandardInput.BaseStream.Write($prefix, 2, 2)
    foreach ($value in $bytes) { $process.StandardInput.BaseStream.WriteByte($value) }
    $process.StandardInput.BaseStream.Flush()
    $replySize = [BitConverter]::ToInt32((Read-Exact $process.StandardOutput.BaseStream 4), 0)
    if ($replySize -lt 1 -or $replySize -gt 1048576) { throw 'Invalid native message prefix.' }
    $reply = Read-Exact $process.StandardOutput.BaseStream $replySize
    return ([Text.Encoding]::UTF8.GetString($reply) | ConvertFrom-Json)
}
try {
    if ((Send-Request 'ping').type -ne 'pong') { throw 'Ping failed.' }
    if ((Send-Request 'capture').type -ne 'error') { throw 'Unprepared capture was accepted.' }
    if ((Send-Request 'unknown').type -ne 'error') { throw 'Unknown command was accepted.' }
    if ((Send-Request 'ping').type -ne 'pong') { throw 'Protocol did not recover after an error.' }
    $process.StandardInput.Close()
    if (-not $process.WaitForExit(5000)) { throw 'Host did not exit at EOF.' }
    if ($process.ExitCode -ne 0) { throw ('Host failed: ' + $process.StandardError.ReadToEnd()) }
    Write-Host 'PASS Windows host compilation, registry, origin allowlist, framed JSON, errors, EOF cleanup'
} catch {
    if (-not $process.HasExited) { $process.Kill(); $process.WaitForExit() }
    Write-Host ('Native host exit code: ' + $process.ExitCode)
    Write-Host ('Native host stderr: ' + $process.StandardError.ReadToEnd())
    throw
} finally {
    if (-not $process.HasExited) { $process.Kill() }
    $process.Dispose()
    & (Join-Path $projectRoot 'windows/uninstall.ps1')
}
