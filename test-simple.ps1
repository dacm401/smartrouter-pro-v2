$ErrorActionPreference = "Continue"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Write-Host "=== 1. Auth ===" -ForegroundColor Cyan
$body = '{"username":"admin","password":"changeme"}'
$r = Invoke-WebRequest -Uri "http://localhost:3001/auth/token" -Method POST -Body $body -ContentType "application/json" -UseBasicParsing
Write-Host "Status: $($r.StatusCode)"
$token = ($r.Content | ConvertFrom-Json).token
Write-Host "Token OK: $($token.Length) chars"

Write-Host ""
Write-Host "=== 2. Archive Tasks (kanban, no session) ===" -ForegroundColor Cyan
$ar = Invoke-WebRequest -Uri "http://localhost:3001/v1/archive/tasks" -Headers @{"Authorization"="Bearer $token"} -UseBasicParsing
Write-Host "Status: $($ar.StatusCode)"
$ar.Content | ConvertFrom-Json | ConvertTo-Json -Depth 3

Write-Host ""
Write-Host "=== 3. Dashboard ===" -ForegroundColor Cyan
$dr = Invoke-WebRequest -Uri "http://localhost:3001/api/dashboard/admin" -Headers @{"Authorization"="Bearer $token"} -UseBasicParsing
Write-Host "Status: $($dr.StatusCode)"
$dr.Content | ConvertFrom-Json | ConvertTo-Json -Depth 2

Write-Host ""
Write-Host "=== 4. Chat (execute mode, non-stream) ===" -ForegroundColor Cyan
$cr = Invoke-WebRequest -Uri "http://localhost:3001/api/chat" -Method POST -Body '{"message":"你好","stream":false,"mode":"execute"}' -ContentType "application/json" -Headers @{"Authorization"="Bearer $token"} -UseBasicParsing -TimeoutSec 30
Write-Host "Status: $($cr.StatusCode)"
Write-Host "Response length: $($cr.Content.Length)"
Write-Host $cr.Content.Substring(0, [Math]::Min(500, $cr.Content.Length))
