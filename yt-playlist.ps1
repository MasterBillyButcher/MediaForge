# ============================================================================
#  MediaForge  -  YouTube Playlist Downloader (one file, copy & paste ready)
# ----------------------------------------------------------------------------
#  EASIEST WAY (paste this ONE line into PowerShell, in any folder):
#
#      irm https://raw.githubusercontent.com/MasterBillyButcher/MediaForge/main/yt-playlist.ps1 | iex
#
#  Or save this file as yt-playlist.ps1, open PowerShell in the folder where
#  you want the downloads, and run:
#
#      powershell -ExecutionPolicy Bypass -File .\yt-playlist.ps1
#
#  Files are saved into the folder you opened PowerShell in.
#  Same options as the MediaForge web app:
#    - Video : MP4 / MKV / WebM, quality from Best down to 144p
#    - Audio : MP3 / M4A / WAV / FLAC / OGG, bitrate 320 / 256 / 192 / 128 kbps
#    - Cookies support (fixes YouTube "Sign in to confirm you're not a bot")
#    - Auto-retry of failed videos, skips already downloaded ones (resume)
# ============================================================================

$ErrorActionPreference = 'Stop'
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch { }
$ProgressPreference = 'SilentlyContinue'

$script:ToolsDir = Join-Path $PWD 'MediaForge-tools'

function Write-Title {
    Write-Host ''
    Write-Host '  ============================================' -ForegroundColor Cyan
    Write-Host '   MediaForge  -  YouTube Playlist Downloader' -ForegroundColor Cyan
    Write-Host '  ============================================' -ForegroundColor Cyan
    Write-Host "   Folder: $PWD"
}

function Select-Option {
    param([string]$Prompt, [string[]]$Options)
    Write-Host ''
    Write-Host "  $Prompt" -ForegroundColor White
    for ($i = 0; $i -lt $Options.Count; $i++) {
        Write-Host ('   [{0}] {1}' -f ($i + 1), $Options[$i]) -ForegroundColor Gray
    }
    while ($true) {
        $sel = Read-Host "   Enter 1-$($Options.Count)"
        if ($sel -match '^\d+$' -and [int]$sel -ge 1 -and [int]$sel -le $Options.Count) {
            return [int]$sel
        }
        Write-Host '   Invalid choice, try again.' -ForegroundColor Yellow
    }
}

function Confirm-Question {
    param([string]$Prompt, [bool]$Default = $true)
    $suffix = '[Y/n]'
    if (-not $Default) { $suffix = '[y/N]' }
    $ans = Read-Host "   $Prompt $suffix"
    if ([string]::IsNullOrWhiteSpace($ans)) { return $Default }
    if ($ans -match '^(y|yes)$') { return $true } else { return $false }
}

function Ensure-Tools {
    # Make sure yt-dlp.exe and ffmpeg.exe exist (PATH or .\MediaForge-tools)
    $ytExe = Get-Command 'yt-dlp' -ErrorAction SilentlyContinue
    $ytLocal = Join-Path $script:ToolsDir 'yt-dlp.exe'
    $ffExe = Get-Command 'ffmpeg' -ErrorAction SilentlyContinue
    $ffLocal = Join-Path $script:ToolsDir 'ffmpeg.exe'

    $need = @()
    if (-not $ytExe -and -not (Test-Path $ytLocal)) { $need += 'yt-dlp' }
    if (-not $ffExe -and -not (Test-Path $ffLocal)) { $need += 'ffmpeg' }

    if ($need.Count -gt 0) {
        Write-Host ''
        Write-Host ('   First run: downloading {0} (one-time) ...' -f ($need -join ' + ')) -ForegroundColor Yellow
        New-Item -ItemType Directory -Force -Path $script:ToolsDir | Out-Null
    }

    if (-not $ytExe -and -not (Test-Path $ytLocal)) {
        Invoke-WebRequest -Uri 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe' -OutFile $ytLocal -UseBasicParsing
        Write-Host '   yt-dlp downloaded.' -ForegroundColor Green
    }

    if (-not $ffExe -and -not (Test-Path $ffLocal)) {
        Write-Host '   ffmpeg is about 80 MB, please wait ...' -ForegroundColor Gray
        $zip = Join-Path $env:TEMP 'mf-ffmpeg.zip'
        $tmp = Join-Path $env:TEMP 'mf-ffmpeg-extract'
        $ok = $false
        try {
            Invoke-WebRequest -Uri 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip' -OutFile $zip -UseBasicParsing
            $ok = $true
        } catch {
            Write-Host '   Primary mirror failed, trying GitHub mirror ...' -ForegroundColor Yellow
        }
        if (-not $ok) {
            Invoke-WebRequest -Uri 'https://github.com/BtbN/FFmpeg-Builds/releases/latest/download/ffmpeg-master-latest-win64-gpl.zip' -OutFile $zip -UseBasicParsing
        }
        if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
        Expand-Archive -Path $zip -DestinationPath $tmp -Force
        $bin = Get-ChildItem $tmp -Directory |
            ForEach-Object { Join-Path $_.FullName 'bin' } |
            Where-Object { Test-Path (Join-Path $_ 'ffmpeg.exe') } |
            Select-Object -First 1
        if (-not $bin) { throw 'Could not locate ffmpeg.exe inside the downloaded zip.' }
        Copy-Item (Join-Path $bin 'ffmpeg.exe') $script:ToolsDir -Force
        Copy-Item (Join-Path $bin 'ffprobe.exe') $script:ToolsDir -Force
        Remove-Item $zip -Force -ErrorAction SilentlyContinue
        Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
        Write-Host '   ffmpeg downloaded.' -ForegroundColor Green
    }

    if (Test-Path $ytLocal) { $script:YtDlp = $ytLocal } else { $script:YtDlp = $ytExe.Source }
    $env:Path = "$script:ToolsDir;$env:Path"
}

function Invoke-Download {
    param([string]$Url, [hashtable]$Opts, [string]$CookiesPath)

    $outRoot = $PWD.Path
    $isPlaylist = $Url -match '[?&]list='
    if ($isPlaylist) {
        $tmpl = Join-Path $outRoot '%(playlist_title)s/%(playlist_index)03d - %(title)s.%(ext)s'
    } else {
        $tmpl = Join-Path $outRoot '%(title)s.%(ext)s'
    }

    $dlArgs = @()
    $dlArgs += '--output', $tmpl
    $dlArgs += '--newline', '--ignore-errors', '--no-overwrites', '--continue'
    $dlArgs += '--retries', '10', '--fragment-retries', '10', '--concurrent-fragments', '4'
    $dlArgs += '--windows-filenames', '--trim-filenames', '150'
    $dlArgs += '--download-archive', (Join-Path $outRoot 'MediaForge-downloaded.txt')

    # Thumbnail embedding is not possible for webm video and wav audio
    $canThumb = $Opts.Embed
    if ($Opts.Kind -eq 'video' -and $Opts.Container -eq 'webm') { $canThumb = $false }
    if ($Opts.Kind -eq 'audio' -and $Opts.AudioFormat -eq 'wav') { $canThumb = $false }

    if ($Opts.Embed) { $dlArgs += '--embed-metadata' }
    if ($Opts.Kind -eq 'video' -and $Opts.Embed) { $dlArgs += '--embed-chapters' }
    if ($canThumb) { $dlArgs += '--embed-thumbnail' }

    if ([string]::IsNullOrWhiteSpace($CookiesPath)) {
        # no cookies -> pace the requests a bit to avoid bot blocks
        $dlArgs += '--sleep-interval', '2', '--max-sleep-interval', '5'
    } else {
        $dlArgs += '--cookies', $CookiesPath
    }

    if ($Opts.Kind -eq 'video') {
        $h = [string]$Opts.Height
        if ($Opts.Container -eq 'mp4') {
            $dlArgs += '-f', ("bestvideo[height<=$h][vcodec^=avc1]+bestaudio[ext=m4a]/bestvideo[height<=$h][vcodec^=av01]+bestaudio[ext=m4a]/bestvideo[height<=$h]+bestaudio/best[height<=$h]")
            $dlArgs += '--merge-output-format', 'mp4'
        } elseif ($Opts.Container -eq 'webm') {
            $dlArgs += '-f', ("bestvideo[height<=$h][ext=webm]+bestaudio[ext=webm]/bestvideo[height<=$h]+bestaudio/best[height<=$h]")
            $dlArgs += '--merge-output-format', 'webm'
        } else {
            $dlArgs += '-f', ("bestvideo[height<=$h]+bestaudio/best[height<=$h]")
            $dlArgs += '--merge-output-format', 'mkv'
        }
    } else {
        $dlArgs += '-x', '--audio-format', $Opts.AudioFormat
        if ($Opts.AudioBitrate) { $dlArgs += '--audio-quality', ("{0}K" -f $Opts.AudioBitrate) }
    }

    Write-Host ''
    Write-Host '   Starting download ...' -ForegroundColor Cyan
    Write-Host '   (Ctrl+C to stop - run the script again later, it resumes)' -ForegroundColor Gray
    Write-Host ''

    & $script:YtDlp @dlArgs $Url
    return $LASTEXITCODE
}

function Invoke-Main {
    Write-Title

    # --- URL -------------------------------------------------------------
    Write-Host ''
    Write-Host '   Paste a YouTube playlist URL (or a single video URL).' -ForegroundColor White
    $url = (Read-Host '   URL').Trim()
    if ([string]::IsNullOrWhiteSpace($url)) {
        Write-Host '   No URL entered. Bye.' -ForegroundColor Yellow
        return
    }

    Ensure-Tools

    # --- video or audio ---------------------------------------------------
    $kindIdx = Select-Option -Prompt 'What do you want to download?' -Options @('Video (with sound)', 'Audio only')
    $kind = 'audio'
    if ($kindIdx -eq 1) { $kind = 'video' }

    $opts = @{ Kind = $kind; Height = 0; Container = 'mp4'; AudioFormat = 'mp3'; AudioBitrate = 320; Embed = $true }

    if ($kind -eq 'video') {
        $qIdx = Select-Option -Prompt 'Max quality?' -Options @(
            'Best available', '2160p (4K)', '1440p (2K)', '1080p (Full HD)',
            '720p (HD)', '480p', '360p', '240p', '144p')
        $heights = @(0, 2160, 1440, 1080, 720, 480, 360, 240, 144)
        $opts.Height = $heights[$qIdx - 1]

        $cIdx = Select-Option -Prompt 'Container / format?' -Options @(
            'MP4  (H.264 - plays everywhere)',
            'MKV  (keeps the best codecs, no re-encode)',
            'WebM (VP9 - smaller files)')
        $containers = @('mp4', 'mkv', 'webm')
        $opts.Container = $containers[$cIdx - 1]
    } else {
        $fIdx = Select-Option -Prompt 'Audio format?' -Options @(
            'MP3  (universal)',
            'M4A  (Apple / iTunes)',
            'WAV  (lossless, huge files)',
            'FLAC (lossless, compressed)',
            'OGG  (open format)')
        $formats = @('mp3', 'm4a', 'wav', 'flac', 'vorbis')
        $opts.AudioFormat = $formats[$fIdx - 1]

        if ($opts.AudioFormat -in @('mp3', 'm4a', 'vorbis')) {
            $bIdx = Select-Option -Prompt 'Audio bitrate?' -Options @(
                '320 kbps (best)', '256 kbps', '192 kbps', '128 kbps')
            $bitrates = @(320, 256, 192, 128)
            $opts.AudioBitrate = $bitrates[$bIdx - 1]
        } else {
            $opts.AudioBitrate = $null
        }
    }

    $opts.Embed = Confirm-Question 'Embed thumbnail + metadata/chapters?' $true

    # --- cookies (bot-block fix) ------------------------------------------
    Write-Host ''
    Write-Host '   Getting blocked with "Sign in to confirm you are not a bot"?' -ForegroundColor DarkYellow
    Write-Host '   Export cookies.txt with the free "Get cookies.txt LOCALLY"' -ForegroundColor DarkYellow
    Write-Host '   Chrome extension, then enter its path here. Enter = skip.' -ForegroundColor DarkYellow
    $cookies = (Read-Host '   Cookies.txt path (optional)').Trim('"').Trim()
    if ($cookies) {
        $cookies = [Environment]::ExpandEnvironmentVariables($cookies)
        if (-not (Test-Path $cookies)) {
            Write-Host '   File not found - continuing WITHOUT cookies.' -ForegroundColor Yellow
            $cookies = ''
        }
    }

    # --- summary -----------------------------------------------------------
    $qtext = 'best available'
    if ($kind -eq 'video' -and $opts.Height -gt 0) { $qtext = "$($opts.Height)p max" }
    $detail = ''
    if ($kind -eq 'video') {
        $detail = 'video - {0} - {1}' -f $opts.Container.ToUpper(), $qtext
    } else {
        $btext = 'lossless'
        if ($opts.AudioBitrate) { $btext = "$($opts.AudioBitrate) kbps" }
        $detail = 'audio - {0} - {1}' -f $opts.AudioFormat.ToUpper(), $btext
    }
    $extratext = 'none'
    if ($opts.Embed) { $extratext = 'thumbnail + metadata' }
    $cookietext = 'none'
    if ($cookies) { $cookietext = $cookies }

    Write-Host ''
    Write-Host '   ================ SETTINGS ================' -ForegroundColor Cyan
    Write-Host "    URL     : $url"
    Write-Host "    Type    : $detail"
    Write-Host "    Extras  : $extratext"
    Write-Host "    Cookies : $cookietext"
    Write-Host "    Save to : $PWD"
    Write-Host '   ==========================================' -ForegroundColor Cyan
    $null = Read-Host '   Press Enter to start (Ctrl+C to cancel)'

    # --- download with auto-retry passes ------------------------------------
    $maxPasses = 3
    $code = 1
    for ($pass = 1; $pass -le $maxPasses; $pass++) {
        $code = Invoke-Download -Url $url -Opts $opts -CookiesPath $cookies
        if ($code -eq 0) { break }
        if ($pass -lt $maxPasses) {
            Write-Host ''
            Write-Host "   Some videos failed. Auto-retrying failed ones (attempt $($pass + 1) of $maxPasses) ..." -ForegroundColor Yellow
            Start-Sleep -Seconds 2
        }
    }

    # --- final report --------------------------------------------------------
    $archive = Join-Path $PWD 'MediaForge-downloaded.txt'
    $done = 0
    if (Test-Path $archive) { $done = @(Get-Content $archive).Count }

    Write-Host ''
    if ($code -eq 0) {
        Write-Host '   ALL DONE - everything downloaded.' -ForegroundColor Green
    } else {
        Write-Host '   Finished, but some videos failed.' -ForegroundColor Yellow
        Write-Host '   If YouTube showed "Sign in to confirm you are not a bot":' -ForegroundColor Yellow
        Write-Host '     1. Install the free "Get cookies.txt LOCALLY" Chrome extension' -ForegroundColor Yellow
        Write-Host '     2. On youtube.com click the extension -> Export (Netscape format)' -ForegroundColor Yellow
        Write-Host '     3. Run this script again and enter the cookies.txt path' -ForegroundColor Yellow
    }
    Write-Host "    Files downloaded so far : $done (listed in $archive)"
    Write-Host "    Saved in                : $PWD"
    Write-Host '   Tip: re-running this script skips files you already have.' -ForegroundColor Gray
    Write-Host ''
}

Invoke-Main
