$ErrorActionPreference = "Continue"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# Get token
Write-Host "=== Get JWT ===" -ForegroundColor Cyan
$body = '{"username":"admin","password":"changeme"}'
$tr = Invoke-WebRequest -Uri "http://localhost:3001/auth/token" -Method POST -Body $body -ContentType "application/json" -UseBasicParsing
$token = ($tr.Content | ConvertFrom-Json).token
Write-Host "Token: $($token.Substring(0,30))..."

# Create test archive task
Write-Host ""
Write-Host "=== Create test archive task ===" -ForegroundColor Cyan
$createBody = '{
  "session_id": "test-session-001",
  "turn_id": 1,
  "command": {"action": "research", "task": "测试研究任务", "constraints": [], "priority": "normal"},
  "user_input": "请帮我研究一下 AI 路由技术",
  "constraints": ["不要超过5分钟"],
  "user_id": "dev-user"
}'
$cr = Invoke-WebRequest -Uri "http://localhost:3001/v1/archive/tasks" -Method POST -Body $createBody -ContentType "application/json" -Headers @{"Authorization"="Bearer $token"; "X-User-Id"="dev-user"} -UseBasicParsing
Write-Host "Create status: $($cr.StatusCode)"
$taskData = $cr.Content | ConvertFrom-Json
Write-Host "Created task ID: $($taskData.id)"

# Update status to running
Write-Host ""
Write-Host "=== Update to running ===" -ForegroundColor Cyan
$sr = Invoke-WebRequest -Uri "http://localhost:3001/v1/archive/tasks/$($taskData.id)/status" -Method PATCH -Body '{"status":"running"}' -ContentType "application/json" -Headers @{"Authorization"="Bearer $token"} -UseBasicParsing
Write-Host "Status update: $($sr.StatusCode)"

# Get kanban (all tasks)
Write-Host ""
Write-Host "=== Kanban (all tasks) ===" -ForegroundColor Cyan
$kr = Invoke-WebRequest -Uri "http://localhost:3001/v1/archive/tasks" -Headers @{"Authorization"="Bearer $token"; "X-User-Id"="dev-user"} -UseBasicParsing
Write-Host "Kanban status: $($kr.StatusCode)"
$kr.Content | ConvertFrom-Json | ConvertTo-Json -Depth 3

# Get dashboard
Write-Host ""
Write-Host "=== Dashboard ===" -ForegroundColor Cyan
$dr = Invoke-WebRequest -Uri "http://localhost:3001/api/dashboard/dev-user" -Headers @{"Authorization"="Bearer $token"; "X-User-Id"="dev-user"} -UseBasicParsing
Write-Host "Dashboard status: $($dr.StatusCode)"
$dr.Content | ConvertFrom-Json | ConvertTo-Json -Depth 2

Write-Host ""
Write-Host "=== DONE ===" -ForegroundColor Green
