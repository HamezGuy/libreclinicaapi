# Test Validation Rules and Query Creation
# This script tests that entering invalid form data triggers validation rules and creates queries

$API_BASE = "http://localhost:3001/api"

# Test data with INVALID age (5 years old - outside 18-65 range)
$invalidFormData = @{
    studyId = 9
    subjectId = 6
    eventId = 11
    formId = 13
    formData = @{
        "Patient Initials" = "XX"
        "Date of Birth" = "2020-01-01"
        "Age (years)" = 5
        "Gender" = "M"
        "Informed Consent Obtained" = "true"
        "Eligibility Confirmed" = "true"
    }
}

$headers = @{
    "Authorization" = "Bearer demo"
    "Content-Type" = "application/json"
}

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Testing Validation Rules & Query Creation" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Get current query count
Write-Host "Step 1: Getting current query count..." -ForegroundColor Yellow
$beforeCount = docker exec api-test-db psql -U clinica -d libreclinica_test -t -c "SELECT COUNT(*) FROM discrepancy_note;"
$beforeCount = [int]$beforeCount.Trim()
Write-Host "  Current queries in database: $beforeCount" -ForegroundColor White

# Submit form with invalid data
Write-Host ""
Write-Host "Step 2: Submitting form with INVALID age (5 years)..." -ForegroundColor Yellow
Write-Host "  Age validation rule: Must be between 18 and 65 years" -ForegroundColor Gray

$body = $invalidFormData | ConvertTo-Json -Depth 3

try {
    $response = Invoke-WebRequest -Uri "$API_BASE/forms/save" -Method POST -Body $body -Headers $headers -UseBasicParsing
    Write-Host "  Response Status: $($response.StatusCode)" -ForegroundColor Green
    $responseObj = $response.Content | ConvertFrom-Json
    Write-Host "  Response: $($response.Content)" -ForegroundColor White
} catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    Write-Host "  Response Status: $statusCode" -ForegroundColor $(if ($statusCode -eq 400) { "Yellow" } else { "Red" })
    
    $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
    $errorResponse = $reader.ReadToEnd()
    $errorObj = $errorResponse | ConvertFrom-Json
    
    if ($errorObj.message -eq "Validation failed") {
        Write-Host "  VALIDATION TRIGGERED!" -ForegroundColor Green
        Write-Host "  Errors:" -ForegroundColor Yellow
        foreach ($err in $errorObj.errors) {
            Write-Host "    - $($err.field): $($err.message)" -ForegroundColor White
        }
        if ($errorObj.queriesCreated) {
            Write-Host "  Queries Created: $($errorObj.queriesCreated)" -ForegroundColor Green
        }
    } else {
        Write-Host "  Error: $errorResponse" -ForegroundColor Red
    }
}

# Check query count after
Write-Host ""
Write-Host "Step 3: Checking query count after submission..." -ForegroundColor Yellow
$afterCount = docker exec api-test-db psql -U clinica -d libreclinica_test -t -c "SELECT COUNT(*) FROM discrepancy_note;"
$afterCount = [int]$afterCount.Trim()
Write-Host "  Queries in database now: $afterCount" -ForegroundColor White

$newQueries = $afterCount - $beforeCount
if ($newQueries -gt 0) {
    Write-Host "  NEW QUERIES CREATED: $newQueries" -ForegroundColor Green
    
    # Show the new queries
    Write-Host ""
    Write-Host "Step 4: Showing newly created queries..." -ForegroundColor Yellow
    $newQueriesData = docker exec api-test-db psql -U clinica -d libreclinica_test -c "SELECT dn.discrepancy_note_id, dn.description, dnt.name as type, rs.name as status FROM discrepancy_note dn LEFT JOIN discrepancy_note_type dnt ON dn.discrepancy_note_type_id = dnt.discrepancy_note_type_id LEFT JOIN resolution_status rs ON dn.resolution_status_id = rs.resolution_status_id ORDER BY dn.discrepancy_note_id DESC LIMIT $newQueries;"
    Write-Host $newQueriesData -ForegroundColor White
} else {
    Write-Host "  No new queries created" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Test Complete!" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

