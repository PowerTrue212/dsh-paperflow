#!/usr/bin/env pwsh
# Create the optional PaddleOCR venv used by layout.mjs / layout/worker.py.
#
#   .\layout\setup.ps1 -Python C:\Python312\python.exe
#   .\layout\setup.ps1 -Python python -IndexUrl https://pypi.tuna.tsinghua.edu.cn/simple
#
# Use a python.org install (3.12/3.13). An Anaconda-based venv can fail with
# "libpaddle.pyd DLL load failed" because of conflicting DLLs.

param(
  [string]$Python = "python",
  [string]$Venv = ".venv-layout",
  [string]$IndexUrl = ""
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Push-Location $root
try {
  if (-not (Test-Path $Venv)) {
    Write-Host "Creating venv at $Venv with $Python"
    & $Python -m venv $Venv
    if ($LASTEXITCODE -ne 0) { throw "python -m venv failed" }
  }

  $py = Join-Path $Venv "Scripts\python.exe"
  if (-not (Test-Path $py)) { throw "venv python not found: $py" }

  $common = @()
  if ($IndexUrl) { $common += @("-i", $IndexUrl) }

  & $py -m pip install --upgrade pip @common
  if ($LASTEXITCODE -ne 0) { throw "pip upgrade failed" }

  & $py -m pip install paddlepaddle paddleocr @common
  if ($LASTEXITCODE -ne 0) { throw "paddle install failed" }

  & $py -c "import paddle, paddleocr; print('paddle', paddle.__version__, 'paddleocr', paddleocr.__version__)"
  if ($LASTEXITCODE -ne 0) { throw "paddle import failed" }

  Write-Host ""
  Write-Host "Layout env ready: $py"
  Write-Host "Point config.layout.python at this executable and set layout.enabled: true."
} finally {
  Pop-Location
}
