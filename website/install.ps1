# Windows PowerShell 5.1 or PowerShell 7. No administrator rights required.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$nativeArch = $env:PROCESSOR_ARCHITEW6432
if (!$nativeArch) { $nativeArch = $env:PROCESSOR_ARCHITECTURE }
$arch = switch ($nativeArch) {
    'AMD64' { 'amd64' }
    'ARM64' { 'arm64' }
    default { throw "Unsupported Windows architecture: $nativeArch" }
}
$bin = Join-Path $env:LOCALAPPDATA 'intentflow\bin'
$dest = Join-Path $bin 'intentflow.exe'
$work = Join-Path ([IO.Path]::GetTempPath()) ('intentflow-' + [guid]::NewGuid())
[void][IO.Directory]::CreateDirectory($work)
# PowerShell 5.1 does not read the proxy environment; abide by the variables the CLI documents.
$download = @{ UseBasicParsing = $true }
$proxy = if ($env:HTTPS_PROXY) { $env:HTTPS_PROXY } elseif ($env:HTTP_PROXY) { $env:HTTP_PROXY } else { $null }
if ($proxy) { $download.Proxy = $proxy }
try {
    # Resolve latest once, then use the versioned URL even if a release is published mid-install.
    $releases = 'https://github.com/wlingze/intentflow/releases'
    $manifest = Join-Path $work 'checksums.txt'
    Invoke-WebRequest @download "$releases/latest/download/checksums.txt" -OutFile $manifest
    $pattern = '^([a-fA-F0-9]{64})\s+(intentflow_([0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.+-]+)?)_windows_' + $arch + '\.zip)$'
    $records = @(Select-String -LiteralPath $manifest -Pattern $pattern -CaseSensitive)
    if ($records.Count -ne 1) { throw "Expected one SHA-256 entry for windows/$arch" }
    $fields = $records[0].Matches[0].Groups
    $expected = $fields[1].Value
    $asset = $fields[2].Value
    $version = $fields[3].Value
    "Latest: v$version"
    "Downloading: $asset"
    $archive = Join-Path $work 'archive.zip'
    Invoke-WebRequest @download "$releases/download/v$version/$asset" -OutFile $archive
    if ((Get-FileHash -Algorithm SHA256 -LiteralPath $archive).Hash -ne $expected) {
        throw "SHA-256 mismatch: $asset"
    }
    "SHA-256 OK: $expected"

    # Write only the root executable. Do not unpack arbitrary paths into the install directory.
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [IO.Compression.ZipFile]::OpenRead($archive)
    $candidate = Join-Path $work 'intentflow.exe'
    try {
        $entries = @($zip.Entries | Where-Object { $_.FullName -cin 'intentflow.exe', './intentflow.exe' })
        if ($entries.Count -ne 1 -or $entries[0].Length -eq 0) { throw "Expected intentflow.exe in $asset" }
        [IO.Compression.ZipFileExtensions]::ExtractToFile($entries[0], $candidate)
    } finally { $zip.Dispose() }

    [void][IO.Directory]::CreateDirectory($bin)
    [IO.File]::Copy($candidate, $dest, $true)
    $info = & $dest --version
    if ($LASTEXITCODE -ne 0 -or $info -notlike "$version *") { throw "$dest --version failed: $info" }

    # Preserve unexpanded entries (e.g. %USERPROFILE%) and the registry value type.
    $key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Environment')
    try {
        $raw = $key.GetValue('Path', $null, 'DoNotExpandEnvironmentNames')
        if ($bin -notin ([Environment]::ExpandEnvironmentVariables([string]$raw) -split ';')) {
            $kind = if ($null -eq $raw) { 'ExpandString' } else { $key.GetValueKind('Path') }
            $newPath = if ($raw) { "$bin;$raw" } else { $bin }
            $key.SetValue('Path', $newPath, $kind)
        }
    } finally { $key.Dispose() }
    if ($bin -notin ($env:Path -split ';')) { $env:Path = "$bin;$env:Path" }
    "Installed: $dest"
    $info
} finally {
    [IO.Directory]::Delete($work, $true)
}
