$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# 1. Auth token
Write-Host "=== Auth Token ===" -ForegroundColor Cyan
$body = '{"username":"admin","password":"changeme"}'
$tokenResp = Invoke-WebRequest -Uri "http://localhost:3001/auth/token" -Method POST -Body $body -ContentType "application/json" -UseBasicParsing
$token = ($tokenResp.Content | ConvertFrom-Json).token
Write-Host "Token: $($token.Substring(0, [Math]::Min(50, $token.Length)))..."
Write-Host ""

# 2. 看板数据 - 无 token
Write-Host "=== Archive Tasks (no auth) ===" -ForegroundColor Cyan
try {
    $r = Invoke-WebRequest -Uri "http://localhost:3001/v1/archive/tasks" -UseBasicParsing
    Write-Host "Status: $($r.StatusCode)"
    Write-Host $r.Content
} catch {
    Write-Host "Error: $($_.Exception.Message)"
}
Write-Host ""

# 3. 看板数据 - 带 token（看板视图，无需 session_id）
Write-Host "=== Archive Tasks Kanban (with JWT) ===" -ForegroundColor Cyan
try {
    $r = Invoke-WebRequest -Uri "http://localhost:3001/v1/archive/tasks" -Headers @{Authorization="Bearer $token"} -UseBasicParsing
    Write-Host "Status: $($r.StatusCode)"
    $data = $r.Content | ConvertFrom-Json
    Write-Host "Count: $($data.count)"
    Write-Host "Total: $($data.total)"
    if ($data.entries.Count -gt 0) {
        Write-Host "Recent entries:"
        $data.entries | Select-Object -First 3 | ForEach-Object { Write-Host "  - $($_.id) [$($_.status)]" }
    } else {
        Write-Host "(no entries yet)"
    }
} catch {
    Write-Host "Error: $($_.Exception.Message)"
}
Write-Host ""

# 4. Dashboard
Write-Host "=== Dashboard (with JWT) ===" -ForegroundColor Cyan
try {
    $r = Invoke-WebRequest -Uri "http://localhost:3001/api/dashboard/admin" -Headers @{Authorization="Bearer $token"} -UseBasicParsing
    Write-Host "Status: $($r.StatusCode)"
    Write-Host $r.Content
} catch {
    Write-Host "Error: $($_.Exception.Message)"
}
Write-Host ""

# 5. Chat SSE（简单测试）
Write-Host "=== Chat Execute (with JWT) ===" -ForegroundColor Cyan
try {
    $body2 = '{"message":"hello","stream":false,"mode":"execute"}'
    $r2 = Invoke-WebRequest -Uri "http://localhost:3001/api/chat" -Method POST -Body $body2 -ContentType "application/json" -Headers @{Authorization="Bearer $token"} -UseBasicParsing
    Write-Host "Status: $($r2.StatusCode)"
    Write-Host $r2.Content.Substring(0, [Math]::Min(300, $r2.Content.Length))
} catch {
    Write-Host "Error: $($_.Exception.Message)"
}
