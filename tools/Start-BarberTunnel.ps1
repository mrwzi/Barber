$ErrorActionPreference = "Stop"

$ProjectDir = "C:\Users\AsusIran\OneDrive\Desktop\Barber"
$AppUrl = "http://127.0.0.1:4173"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$PackagedCloudflared = Join-Path $ScriptDir "cloudflared.exe"
$ProjectCloudflared = Join-Path $ProjectDir "tools\cloudflared.exe"
$Cloudflared = $ProjectCloudflared
$LogDir = Join-Path $ProjectDir "logs"
$ServerLog = Join-Path $LogDir "server.log"
$ServerErr = Join-Path $LogDir "server.err.log"

function Write-Step($message) {
  Write-Host ""
  Write-Host "== $message ==" -ForegroundColor Yellow
}

function Test-App {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri "$AppUrl/api/settings" -TimeoutSec 3
    return $response.StatusCode -eq 200
  } catch {
    return $false
  }
}

function Test-PublicUrl($url) {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 5
    return $response.StatusCode -ge 200 -and $response.StatusCode -lt 500
  } catch {
    return $false
  }
}

function Wait-PublicUrl($url) {
  Write-Host "Checking public URL before opening browser..."
  for ($i = 1; $i -le 30; $i++) {
    if (Test-PublicUrl $url) {
      return $true
    }
    Write-Host "Waiting for Cloudflare DNS/tunnel... $i/30"
    Start-Sleep -Seconds 2
  }
  return $false
}

function Ensure-Cloudflared {
  if (Test-Path $PackagedCloudflared) {
    $script:Cloudflared = $PackagedCloudflared
    return
  }
  if (Test-Path $Cloudflared) { return }
  Write-Step "Downloading Cloudflare tunnel"
  New-Item -ItemType Directory -Force -Path (Split-Path $Cloudflared) | Out-Null
  $url = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe"
  Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $Cloudflared
}

Set-Location $ProjectDir
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

Write-Host "Barber Mohamad public tunnel launcher" -ForegroundColor Cyan
Write-Host "Local app: $AppUrl"

Ensure-Cloudflared

if (-not (Test-App)) {
  Write-Step "Starting Barber Mohamad app"
  Start-Process npm.cmd -ArgumentList "start" -WorkingDirectory $ProjectDir -WindowStyle Hidden -RedirectStandardOutput $ServerLog -RedirectStandardError $ServerErr
  for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Seconds 1
    if (Test-App) { break }
  }
}

if (-not (Test-App)) {
  Write-Host "The local app did not start. Check logs:" -ForegroundColor Red
  Write-Host $ServerLog
  Write-Host $ServerErr
  Read-Host "Press Enter to close"
  exit 1
}

Write-Step "Starting public Cloudflare URL"
Write-Host "Waiting for Cloudflare to create a public URL..."
Write-Host "Keep this window open while you use the public link." -ForegroundColor Yellow
Write-Host ""

$processInfo = New-Object System.Diagnostics.ProcessStartInfo
$processInfo.FileName = $Cloudflared
$processInfo.Arguments = "tunnel --url $AppUrl --no-autoupdate"
$processInfo.WorkingDirectory = $ProjectDir
$processInfo.RedirectStandardOutput = $true
$processInfo.RedirectStandardError = $true
$processInfo.UseShellExecute = $false
$processInfo.CreateNoWindow = $true

$process = New-Object System.Diagnostics.Process
$process.StartInfo = $processInfo
[void]$process.Start()

$opened = $false
while (-not $process.HasExited) {
  $line = $process.StandardError.ReadLine()
  if ($line) {
    Write-Host $line
    if (-not $opened -and $line -match "https://[-a-zA-Z0-9.]+\.trycloudflare\.com") {
      $publicUrl = $matches[0]
      Write-Host ""
      Write-Host "Public URL: $publicUrl" -ForegroundColor Green
      Write-Host ""
      if (Wait-PublicUrl $publicUrl) {
        Write-Host "Public URL is ready. Opening browser..." -ForegroundColor Green
        Start-Process $publicUrl
      } else {
        Write-Host "Cloudflare did not make this URL reachable yet." -ForegroundColor Red
        Write-Host "Close this window and run BarberMohamadTunnel.exe again to get a fresh URL."
      }
      $opened = $true
    }
  }
}

Read-Host "Tunnel stopped. Press Enter to close"
