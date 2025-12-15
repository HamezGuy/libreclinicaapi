# LibreClinica Database Backup Management Script
# 21 CFR Part 11 Compliant
#
# This script provides manual backup/restore operations for the LibreClinica database
# For automated backups, use the API endpoint: POST /api/backup/trigger
#
# Usage:
#   .\scripts\backup-management.ps1 -Action backup -Type full
#   .\scripts\backup-management.ps1 -Action restore -BackupFile "backups\full\backup.sql.gz"
#   .\scripts\backup-management.ps1 -Action list
#   .\scripts\backup-management.ps1 -Action cleanup

param(
    [Parameter(Mandatory=$true)]
    [ValidateSet("backup", "restore", "list", "cleanup", "verify", "status")]
    [string]$Action,
    
    [ValidateSet("full", "incremental", "transaction_log")]
    [string]$Type = "full",
    
    [string]$BackupFile,
    
    [string]$ApiUrl = "http://localhost:3001"
)

$ErrorActionPreference = "Stop"

# Colors for output
function Write-ColorOutput($ForegroundColor) {
    $fc = $host.UI.RawUI.ForegroundColor
    $host.UI.RawUI.ForegroundColor = $ForegroundColor
    if ($args) {
        Write-Output $args
    }
    $host.UI.RawUI.ForegroundColor = $fc
}

function Write-Header($text) {
    Write-Host ""
    Write-Host "============================================" -ForegroundColor Cyan
    Write-Host "  $text" -ForegroundColor Cyan
    Write-Host "============================================" -ForegroundColor Cyan
    Write-Host ""
}

function Invoke-BackupApi($endpoint, $method = "GET", $body = $null) {
    try {
        $params = @{
            Uri = "$ApiUrl/api/backup$endpoint"
            Method = $method
            ContentType = "application/json"
        }
        
        if ($body) {
            $params.Body = ($body | ConvertTo-Json)
        }
        
        $response = Invoke-RestMethod @params
        return $response
    }
    catch {
        Write-Host "API Error: $($_.Exception.Message)" -ForegroundColor Red
        return $null
    }
}

# Backup status
function Get-BackupStatus {
    Write-Header "Backup System Status"
    
    $status = Invoke-BackupApi "/status"
    
    if ($status -and $status.success) {
        $data = $status.data
        
        Write-Host "Scheduler Status:" -ForegroundColor Yellow
        Write-Host "  Running: $($data.scheduler.running)"
        Write-Host "  Started At: $($data.scheduler.startedAt)"
        Write-Host "  Last Full Backup: $($data.scheduler.lastFullBackup)"
        Write-Host "  Last Incremental: $($data.scheduler.lastIncrementalBackup)"
        Write-Host ""
        
        Write-Host "Statistics:" -ForegroundColor Yellow
        if ($data.statistics) {
            Write-Host "  Total Backups: $($data.statistics.totalBackups)"
            Write-Host "  Total Size: $([math]::Round($data.statistics.totalSize / 1MB, 2)) MB"
            Write-Host "  Health Status: $($data.statistics.status.healthy)"
            
            if ($data.statistics.status.warnings -and $data.statistics.status.warnings.Count -gt 0) {
                Write-Host ""
                Write-Host "Warnings:" -ForegroundColor Yellow
                foreach ($warning in $data.statistics.status.warnings) {
                    Write-Host "  - $warning" -ForegroundColor Yellow
                }
            }
        }
        
        Write-Host ""
        Write-Host "Configuration:" -ForegroundColor Yellow
        if ($data.config) {
            Write-Host "  Backup Directory: $($data.config.backupDir)"
            Write-Host "  Encryption: $($data.config.encryptionEnabled)"
            Write-Host ""
            Write-Host "  Retention Policy:"
            Write-Host "    Full Backups: $($data.config.retentionDays.full) days"
            Write-Host "    Incremental: $($data.config.retentionDays.incremental) days"
            Write-Host "    Transaction Logs: $($data.config.retentionDays.transactionLog) days"
        }
    }
    else {
        Write-Host "Failed to get backup status. Is the API running?" -ForegroundColor Red
    }
}

# Trigger backup
function Invoke-Backup($type) {
    Write-Header "Triggering $type Backup"
    
    $body = @{ type = $type }
    $result = Invoke-BackupApi "/trigger" "POST" $body
    
    if ($result -and $result.success) {
        Write-Host "Backup started successfully!" -ForegroundColor Green
        Write-Host "Backup ID: $($result.data.backupId)" -ForegroundColor Cyan
        Write-Host ""
        Write-Host "Check status with: .\scripts\backup-management.ps1 -Action status"
    }
    else {
        Write-Host "Backup failed: $($result.message)" -ForegroundColor Red
    }
}

# List backups
function Get-BackupList {
    Write-Header "Available Backups"
    
    $result = Invoke-BackupApi "/list?limit=20"
    
    if ($result -and $result.success -and $result.data) {
        if ($result.data.Count -eq 0) {
            Write-Host "No backups found." -ForegroundColor Yellow
            return
        }
        
        Write-Host "Found $($result.data.Count) backups:" -ForegroundColor Green
        Write-Host ""
        
        foreach ($backup in $result.data) {
            $sizeInMB = [math]::Round($backup.backupSize / 1MB, 2)
            $statusColor = if ($backup.verificationStatus -eq "verified") { "Green" } else { "Yellow" }
            
            Write-Host "[$($backup.backupType.ToUpper())] $($backup.backupId)" -ForegroundColor Cyan
            Write-Host "  Date: $($backup.backupDateTime)"
            Write-Host "  Size: $sizeInMB MB"
            Write-Host "  Status: " -NoNewline
            Write-Host "$($backup.verificationStatus)" -ForegroundColor $statusColor
            Write-Host "  Checksum: $($backup.checksum.Substring(0, 16))..."
            Write-Host "  Retention Until: $($backup.retentionUntil)"
            Write-Host ""
        }
    }
    else {
        Write-Host "Failed to list backups. Is the API running?" -ForegroundColor Red
    }
}

# Cleanup old backups
function Invoke-Cleanup {
    Write-Header "Cleaning Up Expired Backups"
    
    $result = Invoke-BackupApi "/cleanup" "POST"
    
    if ($result -and $result.success) {
        Write-Host "Cleanup completed!" -ForegroundColor Green
        Write-Host "  Deleted: $($result.data.deleted) backups"
        Write-Host "  Freed: $([math]::Round($result.data.freed / 1MB, 2)) MB"
    }
    else {
        Write-Host "Cleanup failed: $($result.message)" -ForegroundColor Red
    }
}

# Verify backup
function Test-Backup($backupId) {
    if (-not $backupId) {
        Write-Host "Please specify a backup ID with -BackupFile parameter" -ForegroundColor Red
        return
    }
    
    Write-Header "Verifying Backup: $backupId"
    
    $result = Invoke-BackupApi "/$backupId/verify" "POST"
    
    if ($result -and $result.success) {
        if ($result.data.verified) {
            Write-Host "Backup integrity VERIFIED!" -ForegroundColor Green
        }
        else {
            Write-Host "Backup integrity check FAILED!" -ForegroundColor Red
        }
        Write-Host "Checksum: $($result.data.checksum)"
    }
    else {
        Write-Host "Verification failed: $($result.message)" -ForegroundColor Red
    }
}

# Main execution
Write-Host ""
Write-Host "LibreClinica Backup Management Tool" -ForegroundColor Magenta
Write-Host "21 CFR Part 11 Compliant" -ForegroundColor DarkGray
Write-Host ""

switch ($Action) {
    "status" { Get-BackupStatus }
    "backup" { Invoke-Backup $Type }
    "list" { Get-BackupList }
    "cleanup" { Invoke-Cleanup }
    "verify" { Test-Backup $BackupFile }
    "restore" {
        Write-Header "Restore Operation"
        Write-Host "Restore operations must be performed via the API for safety." -ForegroundColor Yellow
        Write-Host ""
        Write-Host "To restore, use:" -ForegroundColor Cyan
        Write-Host "  POST /api/backup/{backupId}/restore"
        Write-Host "  Body: { `"confirmRestore`": true, `"targetDatabase`": `"libreclinica_restored`" }"
        Write-Host ""
        Write-Host "Or use a REST client like Postman/curl."
    }
}

Write-Host ""

