param([string]$Installer = (Join-Path $PSScriptRoot '../website/install.ps1'))
# Offline checksum regression; works with Windows PowerShell 5.1 and pwsh in CI.
$ErrorActionPreference = 'Stop'
$root = Join-Path ([IO.Path]::GetTempPath()) ('intentflow-test-' + [guid]::NewGuid())
$oldAppData = $env:LOCALAPPDATA
$oldNative = $env:PROCESSOR_ARCHITEW6432
try {
    $env:LOCALAPPDATA = $root
    $env:PROCESSOR_ARCHITEW6432 = 'ARM64'
    $bin = Join-Path $root 'intentflow/bin'
    [void][IO.Directory]::CreateDirectory($bin)
    $previous = Join-Path $bin 'intentflow.exe'
    [IO.File]::WriteAllText($previous, 'keep previous installation')
    function Invoke-WebRequest([string]$Uri, [string]$OutFile, [switch]$UseBasicParsing, [string]$Proxy = '') {
        $base = 'https://github.com/wlingze/intentflow/releases'
        $asset = 'intentflow_9.8.7_windows_arm64.zip'
        switch ($Uri) {
            "$base/latest/download/checksums.txt" { [IO.File]::WriteAllText($OutFile, ('0' * 64) + "  $asset") }
            "$base/download/v9.8.7/$asset" { [IO.File]::WriteAllText($OutFile, 'corrupt download') }
            default { throw "Unexpected URL: $Uri" }
        }
    }
    try {
        & $Installer
        throw 'Installer accepted a corrupt archive'
    } catch {
        if ($_.Exception.Message -ne 'SHA-256 mismatch: intentflow_9.8.7_windows_arm64.zip') { throw }
    }
    if ([IO.File]::ReadAllText($previous) -ne 'keep previous installation') { throw 'Installer changed previous exe' }
    'ok: native windows/arm64 selected; bad SHA-256 rejected before replacement'
} finally {
    $env:LOCALAPPDATA = $oldAppData
    $env:PROCESSOR_ARCHITEW6432 = $oldNative
    [IO.Directory]::Delete($root, $true)
}
