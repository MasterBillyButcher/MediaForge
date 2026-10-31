<#
=====================================================================
  MediaForge Playlist Downloader  -  PowerShell edition
=====================================================================
  Open ANY folder in PowerShell, run this script, and the playlist
  downloads into that exact folder.

  Same options as the MediaForge web app:
    Video : mp4 / mkv / webm / mov   +  quality 2160 ... 144 / best
    Audio : mp3 / m4a / aac / opus / ogg / wav / flac
            +  bitrate best / 320 / 256 / 192 / 128 / 96
  Extras (same as the app):
    - numbered files        001 - Song Title.mp3
    - skips already-downloaded items (.download-archive.txt)
    - continues past failed/private videos
    - optional cookies for bot-checked / age-restricted media

  HOW TO RUN (first time):
    1. Save this file as  MediaForge-Playlist.ps1
    2. Open PowerShell inside the folder where you want the files
    3. Run:
         powershell -ExecutionPolicy Bypass -File .\MediaForge-Playlist.ps1
       or:
         Set-ExecutionPolicy -Scope Process Bypass
         .\MediaForge-Playlist.ps1
=====================================================================
#>

[CmdletBinding()]
param(
    [string]$Url,      # optional: playlist or video URL (skips the prompt)
    [string]$Format,   # optional: mp4|mkv|webm|mov|mp3|m4a|aac|opus|ogg|wav|flac
    [string]$Quality,  # optional: best|2160|1440|1080|720|480|360|240|144  (video only)
    [string]$Bitrate,  # optional: best|320|256|192|128|96                   (audio only)
    [string]$Cookies,  # optional: chrome|edge|firefox|brave|opera|vivaldi  OR  path to cookies.txt
    [switch]$NoArchive # optional: do not skip previously downloaded videos
)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

$AUDIO_FORMATS = @('mp3', 'm4a', 'aac', 'opus', 'ogg', 'wav', 'flac')
$VIDEO_FORMATS = @('mp4', 'mkv', 'webm', 'mov')
$LOSSLESS      = @('wav', 'flac')

# ----------------------------------------------------------------------
# Helpers
# ----------------------------------------------------------------------
function Show-Menu {
    param([string]$Title, [string[]]$Options, [int]$Default = 1)
    Write-Host ""
    Write-Host "  $Title" -ForegroundColor Cyan
    for ($i = 0; $i -lt $Options.Count; $i++) {
        Write-Host ("    [{0}] {1}" -f ($i + 1), $Options[$i])
    }
    do {
        $sel = Read-Host "  Choose (1-$($Options.Count), Enter = $Default)"
        if ([string]::IsNullOrWhiteSpace($sel)) { $sel = [string]$Default }
        $valid = ($sel -match '^\d+$') -and ([int]$sel -ge 1) -and ([int]$sel -le $Options.Count)
        if (-not $valid) { Write-Host "  Invalid choice, try again." -ForegroundColor Yellow }
    } while (-not $valid)
    return [int]$sel
}

function Get-CommandPath {
    param([string]$Name)
    $c = Get-Command $Name -ErrorAction SilentlyContinue
    if ($c) { return $c.Source }
    return $null
}

# ----------------------------------------------------------------------
# Banner
# ----------------------------------------------------------------------
Write-Host ""
Write-Host "  =================================================" -ForegroundColor Green
Write-Host "    MediaForge Playlist Downloader (PowerShell)"      -ForegroundColor Green
Write-Host "  =================================================" -ForegroundColor Green
Write-Host "  Download folder: $((Get-Location).Path)" -ForegroundColor Gray

# ----------------------------------------------------------------------
# 1) Locate (or install) yt-dlp
# ----------------------------------------------------------------------
$ytDlp = Get-CommandPath 'yt-dlp'
if (-not $ytDlp -and (Test-Path '.\yt-dlp.exe')) { $ytDlp = (Resolve-Path '.\yt-dlp.exe').Path }
if (-not $ytDlp) {
    Write-Host ""
    Write-Host "  yt-dlp was not found." -ForegroundColor Yellow
    $how = Show-Menu -Title "Install yt-dlp?" -Options @(
        "Yes - install with winget (recommended)",
        "Yes - download yt-dlp.exe into this folder",
        "No - exit"
    ) -Default 1
    if ($how -eq 3) { exit }
    if ($how -eq 1) {
        winget install --id yt-dlp.yt-dlp -e --accept-source-agreements --accept-package-agreements
        $ytDlp = Get-CommandPath 'yt-dlp'
        if (-not $ytDlp) {
            Write-Host "  winget install finished but PATH is not refreshed." -ForegroundColor Yellow
            Write-Host "  Close this window, reopen PowerShell and run the script again." -ForegroundColor Yellow
            exit 1
        }
    }
    else {
        $local = Join-Path (Get-Location) 'yt-dlp.exe'
        Write-Host "  Downloading yt-dlp.exe ..." -ForegroundColor Gray
        Invoke-WebRequest -Uri 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe' -OutFile $local
        $ytDlp = $local
    }
}
Write-Host ("  yt-dlp : {0}" -f $ytDlp) -ForegroundColor DarkGray

# ----------------------------------------------------------------------
# 2) Check ffmpeg (needed for merging + audio conversion)
# ----------------------------------------------------------------------
$ffmpeg = Get-CommandPath 'ffmpeg'
if ($ffmpeg) {
    Write-Host ("  ffmpeg : {0}" -f $ffmpeg) -ForegroundColor DarkGray
}
else {
    Write-Host ""
    Write-Host "  WARNING: ffmpeg not found." -ForegroundColor Yellow
    Write-Host "  ffmpeg is required to merge video+audio and to convert audio formats." -ForegroundColor Yellow
    $fix = Show-Menu -Title "Install ffmpeg with winget now?" -Options @("Yes", "No - continue anyway") -Default 1
    if ($fix -eq 1) {
        winget install --id Gyan.FFmpeg -e --accept-source-agreements --accept-package-agreements
        Write-Host "  If PATH was not refreshed, close and reopen PowerShell, then run again." -ForegroundColor Yellow
        exit 1
    }
}

# ----------------------------------------------------------------------
# 3) URLs
# ----------------------------------------------------------------------
$urls = @()
if ($Url) {
    $urls += $Url.Trim()
}
else {
    Write-Host ""
    Write-Host "  Paste one or more playlist / video URLs." -ForegroundColor Cyan
    Write-Host "  Press ENTER on an empty line to start."
    while ($true) {
        $line = Read-Host "  URL"
        if ([string]::IsNullOrWhiteSpace($line)) { break }
        $urls += $line.Trim()
    }
    if ($urls.Count -eq 0) { Write-Host "  No URL entered. Bye." -ForegroundColor Yellow; exit }
}

# ----------------------------------------------------------------------
# 4) Format / quality / bitrate  (same options as the web app)
# ----------------------------------------------------------------------
$fmt = $Format
if (-not $fmt) {
    $f = Show-Menu -Title "Output format" -Options (@($VIDEO_FORMATS | ForEach-Object { "$_  (video)" }) +
                                                @($AUDIO_FORMATS | ForEach-Object { "$_  (audio)" }))
    if ($f -le $VIDEO_FORMATS.Count) { $fmt = $VIDEO_FORMATS[$f - 1] }
    else { $fmt = $AUDIO_FORMATS[$f - $VIDEO_FORMATS.Count - 1] }
}
$fmt = $fmt.ToLowerInvariant()
if ($VIDEO_FORMATS -notcontains $fmt -and $AUDIO_FORMATS -notcontains $fmt) {
    Write-Host "  Unknown format '$Format'. Bye." -ForegroundColor Red; exit 1
}

$isAudio = $AUDIO_FORMATS -contains $fmt

$quality = $Quality
if (-not $isAudio) {
    if (-not $quality) {
        $q = Show-Menu -Title "Video quality" -Options @(
            'best available', '2160p (4K)', '1440p (2K)', '1080p (Full HD)', '720p (HD)',
            '480p', '360p', '240p', '144p'
        ) -Default 4
        $quality = @('best', '2160', '1440', '1080', '720', '480', '360', '240', '144')[$q - 1]
    }
}
else {
    $quality = 'best'
}

$bitrate = $Bitrate
if ($isAudio -and $LOSSLESS -notcontains $fmt) {
    if (-not $bitrate) {
        $b = Show-Menu -Title "Audio bitrate" -Options @('best', '320 kbps', '256 kbps', '192 kbps', '128 kbps', '96 kbps') -Default 4
        $bitrate = @('best', '320', '256', '192', '128', '96')[$b - 1]
    }
}
else {
    $bitrate = 'best'
}

# ----------------------------------------------------------------------
# 5) Cookies (fixes "Sign in to confirm you're not a bot" / age limits)
# ----------------------------------------------------------------------
$cookiesArgs = @()
if ($Cookies) {
    if ($Cookies -match '\.(txt)$' -or (Test-Path $Cookies)) {
        $cookiesArgs = @('--cookies', $Cookies)
    }
    else {
        $cookiesArgs = @('--cookies-from-browser', $Cookies.ToLowerInvariant())
    }
}
else {
    $c = Show-Menu -Title "Cookies (recommended for YouTube on some networks)" -Options @(
        "No cookies", "Use my browser's cookies", "Use a cookies.txt file"
    ) -Default 1
    if ($c -eq 2) {
        $br = Show-Menu -Title "Which browser?" -Options @('Chrome', 'Edge', 'Firefox', 'Brave', 'Opera', 'Vivaldi') -Default 2
        $cookiesArgs = @('--cookies-from-browser', @('chrome', 'edge', 'firefox', 'brave', 'opera', 'vivaldi')[$br - 1])
    }
    elseif ($c -eq 3) {
        $cp = Read-Host "  Path to cookies.txt"
        if ([string]::IsNullOrWhiteSpace($cp) -or -not (Test-Path $cp)) {
            Write-Host "  Cookies file not found - continuing without cookies." -ForegroundColor Yellow
        }
        else {
            $cookiesArgs = @('--cookies', $cp)
        }
    }
}

# ----------------------------------------------------------------------
# 6) Which videos? (playlist selection)
# ----------------------------------------------------------------------
$plItems = @()
if (-not $Url) {
    $rng = Read-Host "  Videos to download [all | e.g. 1-50 | 1,3,7-20]  (Enter = all)"
    $rng = $rng.Trim()
    if ($rng -and $rng -ne 'all') { $plItems = @('--playlist-items', $rng) }
}

# ----------------------------------------------------------------------
# 7) Build the yt-dlp command (mirrors the MediaForge worker engine)
# ----------------------------------------------------------------------
$ytArgs = @(
    '--no-warnings', '--ignore-config', '--no-color',
    '--socket-timeout', '25', '--retries', '3', '--fragment-retries', '3',
    '--concurrent-fragments', '4',
    '--no-overwrites', '--continue', '--ignore-errors', '--no-mtime',
    '--windows-filenames', '--embed-metadata', '--newline'
)

if (-not $NoArchive) {
    $archive = Join-Path (Get-Location) '.download-archive.txt'
    $ytArgs += @('--download-archive', $archive)
    Write-Host ""
    Write-Host "  Skipping already-downloaded items via $archive" -ForegroundColor DarkGray
}

if ($isAudio) {
    $ytArgs += @('-f', 'ba/b', '-x', '--audio-format', $fmt)
    if ($LOSSLESS -notcontains $fmt) {
        if ($bitrate -eq 'best') { $ytArgs += @('--audio-quality', '0') }
        else { $ytArgs += @('--audio-quality', "$bitrate`K") }
    }
    if (@('mp3', 'm4a') -contains $fmt) { $ytArgs += @('--embed-thumbnail') }
}
else {
    switch ($fmt) {
        'mp4' { $fstr = "bv*[height<=$quality][vcodec^=avc1]+ba[acodec^=mp4a]/bv*[height<=$quality]+ba/b[height<=$quality]/b" }
        'mov' { $fstr = "bv*[height<=$quality][vcodec^=avc1]+ba[acodec^=mp4a]/bv*[height<=$quality]+ba/b[height<=$quality]/b" }
        'webm' { $fstr = "bv*[height<=$quality][ext=webm]+ba[ext=webm]/bv*[ext=webm]+ba/b[ext=webm]/b[height<=$quality]/b" }
        default { $fstr = "bv*[height<=$quality]+ba/b[height<=$quality]/b" }
    }
    if ($quality -eq 'best') {
        switch ($fmt) {
            'mp4' { $fstr = "bv*[vcodec^=avc1]+ba[acodec^=mp4a]/bv*+ba/b" }
            'webm' { $fstr = "bv*[ext=webm]+ba[ext=webm]/bv*+ba/b" }
            default { $fstr = "bv*+ba/b" }
        }
    }
    $ytArgs += @('-f', $fstr, '--merge-output-format', $fmt)
    if ($fmt -ne 'webm') { $ytArgs += @('--embed-thumbnail') }
}

Write-Host ""
Write-Host ("  Format: {0} | Quality: {1} | Bitrate: {2}" -f $fmt, $quality, $bitrate) -ForegroundColor Cyan
Write-Host "  ----------------------------------------------------------------" -ForegroundColor DarkGray

$okCount = 0
$failCount = 0

foreach ($u in $urls) {
    $isPlaylist = ($u -match '[?&]list=')
    if ($isPlaylist) { $outTpl = '%(playlist_index)03d - %(title).90B.%(ext)s' }
    else { $outTpl = '%(title).90B.%(ext)s' }

    $runArgs = $ytArgs + @('-o', $outTpl) + $plItems + @('--', $u)

    Write-Host ""
    Write-Host "  >> $u" -ForegroundColor White
    & $ytDlp @runArgs
    if ($LASTEXITCODE -eq 0) { $okCount++ }
    else { $failCount++; Write-Host "  Finished with errors (some videos may have been skipped)." -ForegroundColor Yellow }
}

Write-Host ""
Write-Host "  =================================================" -ForegroundColor Green
Write-Host ("    Done.  Sources OK: {0}   With issues: {1}" -f $okCount, $failCount) -ForegroundColor Green
Write-Host ("    Files saved in: {0}" -f (Get-Location).Path) -ForegroundColor Green
Write-Host "  =================================================" -ForegroundColor Green
