<#
.SYNOPSIS
    รีเซ็ตรหัสผ่านของผู้ใช้ postgres ใน PostgreSQL 18 บนเครื่องนี้ แล้วอัปเดต .env ให้อัตโนมัติ

.DESCRIPTION
    ต้องรันด้วยสิทธิ์ Administrator เพราะต้องแก้ไฟล์ pg_hba.conf ใน C:\Program Files

    ขั้นตอนที่สคริปต์ทำ
      1. สำรอง pg_hba.conf ไว้ก่อน
      2. เปลี่ยน auth method ของ localhost เป็น trust ชั่วคราว (เข้าได้โดยไม่ใช้รหัส)
      3. restart service PostgreSQL
      4. ALTER USER postgres WITH PASSWORD '<รหัสใหม่>'
      5. สร้าง database teenstyle ถ้ายังไม่มี
      6. คืน pg_hba.conf กลับเป็นค่าเดิม แล้ว restart อีกครั้ง   <-- ทำใน finally เสมอ
      7. ทดสอบเชื่อมต่อด้วยรหัสใหม่
      8. เขียนรหัสใหม่ลง .env (POSTGRES_PASSWORD และ DATABASE_URL)

    ความปลอดภัย
      - โหมด trust เปิดเฉพาะ localhost และเปิดอยู่ไม่กี่วินาที
      - ถ้าสคริปต์ล้มกลางทาง บล็อก finally จะคืนไฟล์เดิมและ restart ให้เสมอ
      - ไฟล์สำรองยังเก็บไว้ให้ตรวจย้อนหลัง (pg_hba.conf.bak-<เวลา>)

.PARAMETER Password
    รหัสผ่านใหม่ที่ต้องการ ถ้าไม่ใส่ สคริปต์จะสุ่มให้ 24 ตัวอักษร (a-z A-Z 0-9)
    ใช้เฉพาะตัวอักษรและตัวเลข เพื่อไม่ต้อง percent-encode ใน DATABASE_URL

.EXAMPLE
    # สุ่มรหัสให้อัตโนมัติ (แนะนำ)
    .\scripts\reset-pg-password.ps1

.EXAMPLE
    # กำหนดรหัสเอง
    .\scripts\reset-pg-password.ps1 -Password "MyDevPassword123"
#>
[CmdletBinding()]
param(
    [string]$Password,
    [string]$PgRoot = 'C:\Program Files\PostgreSQL\18',
    [string]$ServiceName = 'postgresql-x64-18',
    [string]$DatabaseName = 'teenstyle'
)

$ErrorActionPreference = 'Stop'

# ให้ console แสดงภาษาไทยได้ถูกต้องบน Windows PowerShell 5.1
# (ไฟล์นี้ต้องบันทึกเป็น UTF-8 with BOM ด้วย ไม่งั้น 5.1 จะอ่านเป็น ANSI)
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

# ─── 0. ตรวจสิทธิ์และ path ที่จำเป็น ─────────────────────────────────────────

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
    Write-Host ''
    Write-Host '  ต้องรันสคริปต์นี้ด้วยสิทธิ์ Administrator' -ForegroundColor Red
    Write-Host ''
    Write-Host '  วิธีทำ:' -ForegroundColor Yellow
    Write-Host '    1. กดปุ่ม Windows แล้วพิมพ์  PowerShell'
    Write-Host '    2. คลิกขวาที่ Windows PowerShell -> Run as administrator'
    Write-Host '    3. รันคำสั่งนี้:'
    Write-Host ''
    Write-Host '       cd C:\Users\ACER\Desktop\web003' -ForegroundColor Cyan
    Write-Host '       powershell -ExecutionPolicy Bypass -File .\scripts\reset-pg-password.ps1' -ForegroundColor Cyan
    Write-Host ''
    exit 1
}

$hbaPath  = Join-Path $PgRoot 'data\pg_hba.conf'
$psqlPath = Join-Path $PgRoot 'bin\psql.exe'
$repoRoot = Split-Path -Parent $PSScriptRoot
$envPath  = Join-Path $repoRoot '.env'

foreach ($required in @($hbaPath, $psqlPath)) {
    if (-not (Test-Path $required)) {
        Write-Host "  ไม่พบไฟล์ที่ต้องใช้: $required" -ForegroundColor Red
        Write-Host '  ถ้า PostgreSQL ติดตั้งไว้ที่อื่น ให้ส่งพารามิเตอร์ -PgRoot "<path>"' -ForegroundColor Yellow
        exit 1
    }
}

if (-not (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue)) {
    Write-Host "  ไม่พบ service '$ServiceName'" -ForegroundColor Red
    Get-Service -Name '*postgres*' | Format-Table Name, Status -AutoSize
    exit 1
}

# ─── 1. เตรียมรหัสผ่านใหม่ ───────────────────────────────────────────────────

if ([string]::IsNullOrWhiteSpace($Password)) {
    $alphabet = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
    $bytes = New-Object 'byte[]' 24
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $Password = -join ($bytes | ForEach-Object { $alphabet[$_ % $alphabet.Length] })
    $generated = $true
} else {
    if ($Password -notmatch '^[A-Za-z0-9]+$') {
        Write-Host '  รหัสผ่านควรมีแต่ตัวอักษรและตัวเลข เพื่อไม่ต้อง percent-encode ใน DATABASE_URL' -ForegroundColor Red
        exit 1
    }
    $generated = $false
}

Write-Host ''
Write-Host '  TEENSTYLE AI - reset PostgreSQL password' -ForegroundColor Magenta
Write-Host '  ----------------------------------------'
Write-Host "  PostgreSQL : $PgRoot"
Write-Host "  service    : $ServiceName"
Write-Host "  .env       : $envPath"
Write-Host ''

$backupPath = "$hbaPath.bak-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
$restored = $false
$envWritten = $false

try {
    # ─── 2. สำรอง pg_hba.conf ────────────────────────────────────────────────
    Copy-Item $hbaPath $backupPath -Force
    Write-Host "  [1/7] สำรอง pg_hba.conf -> $(Split-Path -Leaf $backupPath)" -ForegroundColor Green

    # ─── 3. เปิด trust ชั่วคราว (เฉพาะบรรทัดที่ไม่ใช่ comment) ───────────────
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    $hba = [System.IO.File]::ReadAllLines($hbaPath)
    $patched = $hba | ForEach-Object {
        if ($_ -match '^\s*#' -or $_ -notmatch '\S') { $_ }
        else { $_ -replace '(scram-sha-256|md5|password)\s*$', 'trust' }
    }
    [System.IO.File]::WriteAllLines($hbaPath, $patched, $utf8NoBom)
    Write-Host '  [2/7] เปิด trust ชั่วคราวสำหรับ localhost' -ForegroundColor Green

    # ─── 4. restart แล้วรอให้พร้อมรับ connection ─────────────────────────────
    Restart-Service -Name $ServiceName -Force
    $ready = $false
    for ($i = 0; $i -lt 30; $i++) {
        & $psqlPath -U postgres -h 127.0.0.1 -d postgres -tAc 'SELECT 1' *> $null
        if ($LASTEXITCODE -eq 0) { $ready = $true; break }
        Start-Sleep -Seconds 1
    }
    if (-not $ready) { throw 'restart แล้วแต่ยังเชื่อมต่อไม่ได้ภายใน 30 วินาที' }
    Write-Host '  [3/7] restart service สำเร็จ' -ForegroundColor Green

    # ─── 5. ตั้งรหัสใหม่ ─────────────────────────────────────────────────────
    # ส่งรหัสผ่านตัวแปร psql เพื่อไม่ให้รหัสไปอยู่ใน command line ที่อื่นเห็นได้
    $alter = "\set pw '$Password'`nALTER USER postgres WITH PASSWORD :'pw';"
    $alter | & $psqlPath -U postgres -h 127.0.0.1 -d postgres -v ON_ERROR_STOP=1 -q -f - *> $null
    if ($LASTEXITCODE -ne 0) { throw 'ALTER USER ไม่สำเร็จ' }
    Write-Host '  [4/8] ตั้งรหัสผ่านใหม่ให้ผู้ใช้ postgres แล้ว' -ForegroundColor Green

    # ─── 5.1 บันทึกรหัสทันที ก่อนทำอย่างอื่นที่อาจล้ม ────────────────────────
    # สำคัญ: รหัสถูกเปลี่ยนไปแล้ว ถ้าขั้นถัดไปล้มโดยยังไม่บันทึก จะไม่มีใครรู้รหัส
    Write-Host ''
    Write-Host '        รหัสผ่านใหม่ของผู้ใช้ postgres:' -ForegroundColor Yellow
    Write-Host "        $Password" -ForegroundColor White
    Write-Host ''

    if (Test-Path $envPath) {
        $utf8NoBomEnv = New-Object System.Text.UTF8Encoding($false)
        $envText = [System.IO.File]::ReadAllText($envPath, [System.Text.Encoding]::UTF8)
        $envText = $envText -replace '(?m)^POSTGRES_PASSWORD=.*$', "POSTGRES_PASSWORD=$Password"
        $envText = $envText -replace '(?m)^DATABASE_URL=.*$',
            "DATABASE_URL=postgresql://postgres:$Password@localhost:5432/$DatabaseName`?schema=public"
        [System.IO.File]::WriteAllText($envPath, $envText, $utf8NoBomEnv)
        Write-Host '  [5/8] บันทึกรหัสลง .env แล้ว (POSTGRES_PASSWORD + DATABASE_URL)' -ForegroundColor Green
        $envWritten = $true
    } else {
        Write-Host "  [5/8] ไม่พบ $envPath - ต้องคัดลอกรหัสด้านบนไปใส่เอง" -ForegroundColor Yellow
    }

    # ─── 6. สร้าง database ถ้ายังไม่มี ───────────────────────────────────────
    # -join '' กัน psql คืนค่าว่าง (null) แล้วเรียก .Trim() ไม่ได้
    $existsRaw = (& $psqlPath -U postgres -h 127.0.0.1 -d postgres -tAc `
        "SELECT 1 FROM pg_database WHERE datname = '$DatabaseName'") -join ''

    if ($existsRaw.Trim() -eq '1') {
        Write-Host "  [6/8] database `"$DatabaseName`" มีอยู่แล้ว" -ForegroundColor Green
    } else {
        & $psqlPath -U postgres -h 127.0.0.1 -d postgres -q -c "CREATE DATABASE `"$DatabaseName`"" *> $null
        if ($LASTEXITCODE -ne 0) { throw "สร้าง database $DatabaseName ไม่สำเร็จ" }
        Write-Host "  [6/8] สร้าง database `"$DatabaseName`" แล้ว" -ForegroundColor Green
    }
}
finally {
    # ─── 6. คืน pg_hba.conf กลับเสมอ ไม่ว่าจะสำเร็จหรือล้ม ───────────────────
    if (Test-Path $backupPath) {
        Copy-Item $backupPath $hbaPath -Force
        Restart-Service -Name $ServiceName -Force
        $restored = $true
        Write-Host '  [7/8] คืน pg_hba.conf เป็น scram-sha-256 และ restart แล้ว' -ForegroundColor Green
    }
}

if (-not $restored) {
    Write-Host '  คืน pg_hba.conf ไม่สำเร็จ - ตรวจไฟล์ด้วยตัวเองทันที' -ForegroundColor Red
    exit 1
}

# ─── 8. ทดสอบรหัสใหม่หลังคืน pg_hba.conf แล้ว ───────────────────────────────

$env:PGPASSWORD = $Password
& $psqlPath -U postgres -h 127.0.0.1 -d $DatabaseName -tAc 'SELECT 1' *> $null
$loginOk = ($LASTEXITCODE -eq 0)
Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue

if ($loginOk) {
    Write-Host '  [8/8] ทดสอบเชื่อมต่อด้วยรหัสใหม่ผ่าน' -ForegroundColor Green
} else {
    Write-Host '  [8/8] ทดสอบเชื่อมต่อด้วยรหัสใหม่ไม่ผ่าน' -ForegroundColor Red
    Write-Host '        รหัสถูกตั้งไปแล้วตามค่าด้านบน ลองรัน  npm run db:check  เพื่อดูรายละเอียด' -ForegroundColor Yellow
}

Write-Host ''
Write-Host '  เสร็จแล้ว' -ForegroundColor Green
Write-Host ''
Write-Host '  รหัสผ่านใหม่ของผู้ใช้ postgres (เก็บไว้ให้ดี - ใช้กับ pgAdmin ด้วย):' -ForegroundColor Yellow
Write-Host "     $Password" -ForegroundColor White
if ($envWritten) {
    Write-Host '  บันทึกไว้ใน .env แล้ว ซึ่งอยู่ใน .gitignore' -ForegroundColor DarkGray
} else {
    Write-Host '  ยังไม่ได้บันทึกลง .env - ต้องคัดลอกไปใส่เอง' -ForegroundColor Yellow
}
Write-Host ''
Write-Host '  ขั้นต่อไป กลับไปที่ Claude Code แล้วพิมพ์ว่า  รีเซ็ตแล้ว' -ForegroundColor Cyan
Write-Host ''
