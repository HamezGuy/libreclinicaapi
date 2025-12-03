# Template Flow Diagnostic Script
# Tests: Login -> Create Template -> Retrieve Template -> Retrieve with Fields

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "   Template CRUD Flow Diagnostic Test" -ForegroundColor Cyan
Write-Host "========================================`n" -ForegroundColor Cyan

$baseUrl = "http://localhost:3001/api"

# Step 1: Login
Write-Host "Step 1: Logging in..." -ForegroundColor Yellow
$loginBody = @{ username = 'root'; password = '12345678' } | ConvertTo-Json
try {
    $loginResponse = Invoke-RestMethod -Uri "$baseUrl/auth/login" -Method Post -ContentType "application/json" -Body $loginBody
    if ($loginResponse.success) {
        Write-Host "  [OK] Login successful" -ForegroundColor Green
        $token = $loginResponse.accessToken
    } else {
        Write-Host "  [FAIL] Login failed: $($loginResponse.message)" -ForegroundColor Red
        exit 1
    }
} catch {
    Write-Host "  [FAIL] Login error: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

$headers = @{ 'Authorization' = "Bearer $token"; 'Content-Type' = 'application/json' }

# Step 2: Get existing templates
Write-Host "`nStep 2: Fetching existing templates..." -ForegroundColor Yellow
try {
    $templates = Invoke-RestMethod -Uri "$baseUrl/forms" -Method Get -Headers $headers
    if ($templates.success) {
        Write-Host "  [OK] Found $($templates.total) templates" -ForegroundColor Green
        $templates.data | ForEach-Object { Write-Host "       - $($_.name) (ID: $($_.crf_id))" }
    } else {
        Write-Host "  [WARN] Could not fetch templates" -ForegroundColor Yellow
    }
} catch {
    Write-Host "  [FAIL] Error fetching templates: $($_.Exception.Message)" -ForegroundColor Red
}

# Step 3: Create new template
$timestamp = Get-Date -Format "yyyyMMddHHmmss"
$testTemplateName = "Diagnostic Test Form $timestamp"
Write-Host "`nStep 3: Creating new template '$testTemplateName'..." -ForegroundColor Yellow

$createBody = @{
    name = $testTemplateName
    description = "Created by diagnostic script"
    fields = @(
        @{
            label = "Patient Name"
            type = "text"
            required = $true
        },
        @{
            label = "Age"
            type = "number"
            required = $true
            min = 0
            max = 120
        },
        @{
            label = "Gender"
            type = "select"
            options = @(
                @{ label = "Male"; value = "male" },
                @{ label = "Female"; value = "female" },
                @{ label = "Other"; value = "other" }
            )
        },
        @{
            label = "Date of Visit"
            type = "date"
            required = $true
        },
        @{
            label = "Notes"
            type = "textarea"
            required = $false
        }
    )
} | ConvertTo-Json -Depth 5

try {
    $createResponse = Invoke-RestMethod -Uri "$baseUrl/forms" -Method Post -Headers $headers -Body $createBody
    if ($createResponse.success) {
        Write-Host "  [OK] Template created with ID: $($createResponse.crfId)" -ForegroundColor Green
        $createdCrfId = $createResponse.crfId
    } else {
        Write-Host "  [FAIL] Create failed: $($createResponse.message)" -ForegroundColor Red
        exit 1
    }
} catch {
    Write-Host "  [FAIL] Create error: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

# Step 4: Retrieve template by ID
Write-Host "`nStep 4: Retrieving template by ID ($createdCrfId)..." -ForegroundColor Yellow
try {
    $getResponse = Invoke-RestMethod -Uri "$baseUrl/forms/$createdCrfId" -Method Get -Headers $headers
    if ($getResponse.success) {
        Write-Host "  [OK] Template retrieved: $($getResponse.data.name)" -ForegroundColor Green
        Write-Host "       - Description: $($getResponse.data.description)" 
        Write-Host "       - Status: $($getResponse.data.status_name)" 
    } else {
        Write-Host "  [FAIL] Retrieve failed: $($getResponse.message)" -ForegroundColor Red
    }
} catch {
    Write-Host "  [FAIL] Retrieve error: $($_.Exception.Message)" -ForegroundColor Red
}

# Step 5: Retrieve template metadata (fields)
Write-Host "`nStep 5: Retrieving template metadata/fields..." -ForegroundColor Yellow
try {
    $metadataResponse = Invoke-RestMethod -Uri "$baseUrl/forms/$createdCrfId/metadata" -Method Get -Headers $headers
    if ($metadataResponse.success) {
        Write-Host "  [OK] Metadata retrieved" -ForegroundColor Green
        Write-Host "       - CRF: $($metadataResponse.data.crf.name)"
        Write-Host "       - Version: $($metadataResponse.data.version.name)"
        Write-Host "       - Sections: $($metadataResponse.data.sections.Count)"
        Write-Host "       - Fields: $($metadataResponse.data.items.Count)" -ForegroundColor Cyan
        
        $metadataResponse.data.items | ForEach-Object {
            $fieldInfo = "         - $($_.label) ($($_.type))"
            if ($_.required) { $fieldInfo += " [Required]" }
            if ($_.options) { $fieldInfo += " [Options: $($_.options.Count)]" }
            Write-Host $fieldInfo
        }
    } else {
        Write-Host "  [FAIL] Metadata retrieve failed: $($metadataResponse.message)" -ForegroundColor Red
    }
} catch {
    Write-Host "  [FAIL] Metadata retrieve error: $($_.Exception.Message)" -ForegroundColor Red
}

# Step 6: Update template
Write-Host "`nStep 6: Updating template..." -ForegroundColor Yellow
$updateBody = @{
    name = "$testTemplateName (Updated)"
    description = "Updated by diagnostic script"
} | ConvertTo-Json

try {
    $updateResponse = Invoke-RestMethod -Uri "$baseUrl/forms/$createdCrfId" -Method Put -Headers $headers -Body $updateBody
    if ($updateResponse.success) {
        Write-Host "  [OK] Template updated" -ForegroundColor Green
    } else {
        Write-Host "  [FAIL] Update failed: $($updateResponse.message)" -ForegroundColor Red
    }
} catch {
    Write-Host "  [FAIL] Update error: $($_.Exception.Message)" -ForegroundColor Red
}

# Step 7: Verify templates now show the new one
Write-Host "`nStep 7: Verifying template in list..." -ForegroundColor Yellow
try {
    $templates = Invoke-RestMethod -Uri "$baseUrl/forms" -Method Get -Headers $headers
    $found = $templates.data | Where-Object { $_.crf_id -eq $createdCrfId }
    if ($found) {
        Write-Host "  [OK] Template found in list: $($found.name)" -ForegroundColor Green
    } else {
        Write-Host "  [WARN] Template NOT found in list" -ForegroundColor Yellow
    }
} catch {
    Write-Host "  [FAIL] List error: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "   Diagnostic Complete" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

Write-Host "`nSummary:" -ForegroundColor White
Write-Host "  - API endpoint: $baseUrl" 
Write-Host "  - Created template ID: $createdCrfId" 
Write-Host "  - Template name: $testTemplateName" 
Write-Host "`nIf all steps show [OK], the backend CRUD is working correctly." -ForegroundColor Green
Write-Host "If you see issues in the frontend, check:" -ForegroundColor Yellow
Write-Host "  1. Browser console for errors" 
Write-Host "  2. Network tab for API calls" 
Write-Host "  3. Check that you're logged in on the frontend"
Write-Host "  4. Ensure frontend is pointed to port 3001`n"

