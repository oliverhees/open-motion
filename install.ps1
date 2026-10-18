# Open Motion installer for Windows 10/11. No admin rights, everything goes into %LOCALAPPDATA%\OpenMotion.
#
#   powershell -ExecutionPolicy Bypass -c "irm https://raw.githubusercontent.com/oliverhees/open-motion/main/install.ps1 | iex"
#
# Options (environment variables): OM_HOME (install folder), OM_REF (branch or tag, default main),
# OM_WHISPER=1|0 (answer the Whisper question without asking).
# Running it again updates Open Motion. Your projects (OM_HOME\data) stay.

& {
  $ErrorActionPreference = 'Stop'
  $ProgressPreference = 'SilentlyContinue'
  [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

  $NodeVersion = '22.23.3'
  $Repo = 'oliverhees/open-motion'
  $OMHome = if ($env:OM_HOME) { $env:OM_HOME } else { Join-Path $env:LOCALAPPDATA 'OpenMotion' }
  $Ref = if ($env:OM_REF) { $env:OM_REF } else { 'main' }
  $De = (Get-Culture).TwoLetterISOLanguageName -eq 'de'
  function Say($deText, $enText) { if ($De) { Write-Host $deText } else { Write-Host $enText } }

  $arch = switch ($env:PROCESSOR_ARCHITECTURE) { 'AMD64' { 'x64' } 'ARM64' { 'arm64' } default { throw "Unsupported CPU: $env:PROCESSOR_ARCHITECTURE" } }
  if (-not (Get-Command tar.exe -ErrorAction SilentlyContinue)) {
    if ($De) { throw 'tar.exe fehlt. Open Motion braucht Windows 10 (1803) oder neuer.' } else { throw 'tar.exe is missing. Open Motion needs Windows 10 (1803) or newer.' }
  }

  Write-Host ""
  Write-Host "🎬 Open Motion · windows-$arch · $OMHome"
  New-Item -ItemType Directory -Force -Path $OMHome | Out-Null
  $tmp = Join-Path ([IO.Path]::GetTempPath()) ("openmotion-" + [Guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Force -Path $tmp | Out-Null

  try {
    # 1. Node.js (own copy, checksum verified)
    $node = Join-Path $OMHome 'node\node.exe'
    $have = if (Test-Path $node) { & $node -v } else { '' }
    if ($have -ne "v$NodeVersion") {
      Say "⬇️  Node.js $NodeVersion …" "⬇️  Node.js $NodeVersion …"
      $file = "node-v$NodeVersion-win-$arch.zip"
      Invoke-WebRequest "https://nodejs.org/dist/v$NodeVersion/$file" -OutFile (Join-Path $tmp $file) -UseBasicParsing
      $sums = (Invoke-WebRequest "https://nodejs.org/dist/v$NodeVersion/SHASUMS256.txt" -UseBasicParsing).Content
      $want = ($sums -split "`n" | Where-Object { $_ -match " $([regex]::Escape($file))$" }) -replace ' .*$', ''
      $got = (Get-FileHash (Join-Path $tmp $file) -Algorithm SHA256).Hash.ToLower()
      if (-not $want -or $want.Trim().ToLower() -ne $got) {
        if ($De) { throw 'Prüfsumme von Node.js stimmt nicht. Download abgebrochen.' } else { throw 'Node.js checksum mismatch. Aborted.' }
      }
      $nodeDir = Join-Path $OMHome 'node'
      if (Test-Path $nodeDir) { Remove-Item -Recurse -Force $nodeDir }
      Expand-Archive (Join-Path $tmp $file) -DestinationPath $tmp -Force
      Move-Item (Join-Path $tmp "node-v$NodeVersion-win-$arch") $nodeDir
    }

    # 2. Open Motion itself (replaces the old app folder, keeps data\)
    Say "⬇️  Open Motion ($Ref) …" "⬇️  Open Motion ($Ref) …"
    $zip = Join-Path $tmp 'app.zip'
    Invoke-WebRequest "https://codeload.github.com/$Repo/zip/$Ref" -OutFile $zip -UseBasicParsing
    $unz = Join-Path $tmp 'app'
    Expand-Archive $zip -DestinationPath $unz -Force
    $src = Get-ChildItem $unz -Directory | Select-Object -First 1
    $app = Join-Path $OMHome 'app'
    if (Test-Path $app) { Remove-Item -Recurse -Force $app }
    Move-Item $src.FullName $app

    # 3. Everything else (same script on every system)
    & $node (Join-Path $app 'scripts\install\setup.ts') --home $OMHome
    if ($LASTEXITCODE -ne 0) { throw "Setup: exit code $LASTEXITCODE" }
  }
  catch {
    Write-Host ""
    Write-Host "❌ $($_.Exception.Message)" -ForegroundColor Red
    Say 'Bitte diese Meldung kopieren und als Issue melden: https://github.com/oliverhees/open-motion/issues' 'Please copy this message and report it as an issue: https://github.com/oliverhees/open-motion/issues'
  }
  finally {
    Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
  }
}
