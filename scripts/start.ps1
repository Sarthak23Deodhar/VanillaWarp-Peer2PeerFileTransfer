$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)
Write-Host ''
Write-Host '  VANILLAWARP / STARTING UP' -ForegroundColor Green
Write-Host '  Your laptop is the signaling server. Keep it awake and online.'
if (-not (Get-Command javac -ErrorAction SilentlyContinue)) {
    Write-Host 'JDK 17+ is required. Install it and make sure javac is on PATH.' -ForegroundColor Red
    exit 1
}
if (-not (Get-Command ssh -ErrorAction SilentlyContinue)) {
    Write-Host 'OpenSSH is required for the free tunnel. Install Windows OpenSSH Client.' -ForegroundColor Red
    exit 1
}
New-Item -ItemType Directory -Force -Path 'out/vanillawarp' | Out-Null
& javac -d out/vanillawarp src/com/transfer/network/WebRelayServer.java src/com/transfer/gui/P2PApplicationGUI.java
if ($LASTEXITCODE -ne 0) { Write-Host 'Compilation failed.' -ForegroundColor Red; exit 1 }
$env:VANILLAWARP_TUNNEL = '1'
$env:VANILLAWARP_OPEN_BROWSER = '1'
$env:VANILLAWARP_PUBLISH_PAGES = ''
if ((Get-Command gh -ErrorAction SilentlyContinue) -and (Get-Command git -ErrorAction SilentlyContinue)) {
    # Native tools often report status on stderr even on success.
    $previousPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    & gh auth status 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) {
        $repo = (& gh repo view --json nameWithOwner --jq '.nameWithOwner' 2>$null | Select-Object -First 1)
        $branch = (& git branch --show-current 2>$null | Select-Object -First 1)
        if ($repo -match '^([A-Za-z0-9_.-]+)/([A-Za-z0-9_.-]+)$' -and $branch) {
            $owner = $Matches[1].ToLowerInvariant()
            $name = $Matches[2]
            $env:VANILLAWARP_GH_REPO = $repo
            $env:VANILLAWARP_GH_REF = $branch
            $env:VANILLAWARP_PAGES_ORIGIN = "https://$owner.github.io"
            if ($name.ToLowerInvariant() -eq "$owner.github.io") { $env:VANILLAWARP_PAGES_URL = "https://$owner.github.io/" }
            else { $env:VANILLAWARP_PAGES_URL = "https://$owner.github.io/$name/" }
            $env:VANILLAWARP_PUBLISH_PAGES = '1'
            Write-Host "  Pages: $env:VANILLAWARP_PAGES_URL"
        }
    }
    $ErrorActionPreference = $previousPreference
}
if ($env:VANILLAWARP_PUBLISH_PAGES -ne '1') {
    Write-Host '  Automatic Pages publishing is not configured. Local mode will still run.' -ForegroundColor Yellow
    Write-Host '  Install Git and GitHub CLI, sign in to gh on this laptop, and use a cloned repository.'
}
if (-not $env:VANILLAWARP_TURN_API_URL) {
    Write-Host '  Free relay is not configured. Some worldwide connections may fail.' -ForegroundColor Yellow
    Write-Host '  See README for optional relay setup and cost cautions.'
}
Write-Host '  Starting the server and free tunnel...'
& java -cp out/vanillawarp WebRelayServer
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
