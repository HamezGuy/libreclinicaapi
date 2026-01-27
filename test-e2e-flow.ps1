# End-to-End Test Script for Study → Phase → Form → Patient → Validation → Query Flow
# This script tests the complete workflow

$baseUrl = "http://localhost:3001/api"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "E2E TEST: Complete Study Workflow" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

# Step 1: Login
Write-Host "`n[1/8] Logging in..." -ForegroundColor Yellow
$loginResponse = Invoke-RestMethod -Uri "$baseUrl/auth/login" -Method POST -ContentType "application/json" -Body '{"username":"root","password":"12345678"}'
$token = $loginResponse.accessToken
$headers = @{ "Authorization" = "Bearer $token"; "Content-Type" = "application/json" }
Write-Host "✓ Login successful. User: $($loginResponse.user.username)" -ForegroundColor Green

# Step 2: Create a Study
Write-Host "`n[2/8] Creating study..." -ForegroundColor Yellow
$timestamp = [DateTimeOffset]::Now.ToUnixTimeSeconds()
$studyData = @{
    name = "E2E Test Study $timestamp"
    uniqueIdentifier = "E2E_$timestamp"
    summary = "End-to-end test study for validation"
    principalInvestigator = "Dr. Test"
    sponsor = "Test Sponsor"
    phase = "Phase I"
    expectedTotalEnrollment = 100
} | ConvertTo-Json

try {
    $studyResponse = Invoke-RestMethod -Uri "$baseUrl/studies" -Method POST -Headers $headers -Body $studyData
    $studyId = $studyResponse.studyId
    Write-Host "✓ Study created. ID: $studyId" -ForegroundColor Green
} catch {
    Write-Host "✗ Failed to create study: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

# Step 3: Create a Phase (Study Event Definition)
Write-Host "`n[3/8] Creating phase (study event)..." -ForegroundColor Yellow
$phaseData = @{
    studyId = $studyId
    name = "Screening Phase"
    description = "Initial screening visit"
    ordinal = 1
    type = "scheduled"
    repeating = $false
    category = "Study Event"
} | ConvertTo-Json

try {
    $phaseResponse = Invoke-RestMethod -Uri "$baseUrl/events" -Method POST -Headers $headers -Body $phaseData
    $phaseId = $phaseResponse.data.study_event_definition_id
    Write-Host "✓ Phase created. ID: $phaseId" -ForegroundColor Green
} catch {
    Write-Host "✗ Failed to create phase: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "Response: $($_.ErrorDetails.Message)" -ForegroundColor Red
}

# Step 4: Create a Form Template (CRF)
Write-Host "`n[4/8] Creating form template (CRF)..." -ForegroundColor Yellow
$formData = @{
    name = "Vital Signs Form $timestamp"
    description = "Form for recording vital signs"
    version = "1.0"
    fields = @(
        @{
            name = "systolic_bp"
            description = "Systolic Blood Pressure"
            dataType = "INT"
            required = $true
        },
        @{
            name = "diastolic_bp"
            description = "Diastolic Blood Pressure"
            dataType = "INT"
            required = $true
        },
        @{
            name = "heart_rate"
            description = "Heart Rate (bpm)"
            dataType = "INT"
            required = $false
        }
    )
} | ConvertTo-Json -Depth 3

try {
    $formResponse = Invoke-RestMethod -Uri "$baseUrl/forms" -Method POST -Headers $headers -Body $formData
    $crfId = $formResponse.crfId
    Write-Host "✓ Form template created. CRF ID: $crfId" -ForegroundColor Green
} catch {
    Write-Host "✗ Failed to create form: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "Response: $($_.ErrorDetails.Message)" -ForegroundColor Red
}

# Step 5: Assign CRF to Phase
Write-Host "`n[5/8] Assigning form to phase..." -ForegroundColor Yellow
if ($phaseId -and $crfId) {
    $assignData = @{
        crfId = $crfId
        required = $true
        doubleDataEntry = $false
    } | ConvertTo-Json

    try {
        $assignResponse = Invoke-RestMethod -Uri "$baseUrl/events/$phaseId/crfs" -Method POST -Headers $headers -Body $assignData
        Write-Host "✓ Form assigned to phase" -ForegroundColor Green
    } catch {
        Write-Host "✗ Failed to assign form to phase: $($_.Exception.Message)" -ForegroundColor Red
        Write-Host "Response: $($_.ErrorDetails.Message)" -ForegroundColor Red
    }
}

# Step 6: Create a Validation Rule for the CRF
Write-Host "`n[6/8] Creating validation rule..." -ForegroundColor Yellow
if ($crfId) {
    $ruleData = @{
        crfId = $crfId
        fieldName = "systolic_bp"
        ruleType = "range"
        expression = "systolic_bp >= 60 AND systolic_bp <= 250"
        errorMessage = "Systolic BP must be between 60 and 250 mmHg"
        severity = "error"
        enabled = $true
        minValue = 60
        maxValue = 250
    } | ConvertTo-Json

    try {
        $ruleResponse = Invoke-RestMethod -Uri "$baseUrl/validation-rules" -Method POST -Headers $headers -Body $ruleData
        $ruleId = $ruleResponse.data.id
        Write-Host "✓ Validation rule created. ID: $ruleId" -ForegroundColor Green
    } catch {
        Write-Host "✗ Failed to create validation rule: $($_.Exception.Message)" -ForegroundColor Red
        Write-Host "Response: $($_.ErrorDetails.Message)" -ForegroundColor Red
    }
}

# Step 7: Create a Patient (Subject) and assign to study
Write-Host "`n[7/8] Creating patient and assigning to study..." -ForegroundColor Yellow
$patientData = @{
    studyId = $studyId
    studySubjectId = "SUBJ-$timestamp"
    gender = "m"
    dateOfBirth = "1980-01-15"
    enrollmentDate = (Get-Date).ToString("yyyy-MM-dd")
} | ConvertTo-Json

try {
    $patientResponse = Invoke-RestMethod -Uri "$baseUrl/subjects" -Method POST -Headers $headers -Body $patientData
    $subjectId = $patientResponse.data.studySubjectId
    $studySubjectId = $patientResponse.data.id
    Write-Host "✓ Patient created and enrolled. Subject ID: $subjectId, Study Subject ID: $studySubjectId" -ForegroundColor Green
} catch {
    Write-Host "✗ Failed to create patient: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "Response: $($_.ErrorDetails.Message)" -ForegroundColor Red
}

# Step 8: Get patient's events and verify event_crfs were created
Write-Host "`n[8/8] Verifying patient's phases and forms..." -ForegroundColor Yellow
if ($studySubjectId) {
    try {
        $eventsResponse = Invoke-RestMethod -Uri "$baseUrl/events/subject/$studySubjectId" -Method GET -Headers $headers
        Write-Host "✓ Patient has $($eventsResponse.total) scheduled event(s)" -ForegroundColor Green
        
        foreach ($event in $eventsResponse.data) {
            Write-Host "  - Event: $($event.event_name) (ID: $($event.study_event_id))" -ForegroundColor Cyan
            
            # Get event_crfs for this event
            try {
                $crfsResponse = Invoke-RestMethod -Uri "$baseUrl/events/instance/$($event.study_event_id)/crfs" -Method GET -Headers $headers
                Write-Host "    Forms assigned: $($crfsResponse.total)" -ForegroundColor Cyan
                foreach ($crf in $crfsResponse.data) {
                    Write-Host "      - $($crf.crf_name) (event_crf_id: $($crf.event_crf_id))" -ForegroundColor White
                }
            } catch {
                Write-Host "    ✗ Failed to get event CRFs: $($_.Exception.Message)" -ForegroundColor Red
            }
        }
    } catch {
        Write-Host "✗ Failed to get patient events: $($_.Exception.Message)" -ForegroundColor Red
        Write-Host "Response: $($_.ErrorDetails.Message)" -ForegroundColor Red
    }
}

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "E2E TEST COMPLETE" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

# Summary
Write-Host "`nSummary:" -ForegroundColor Yellow
Write-Host "  Study ID: $studyId"
Write-Host "  Phase ID: $phaseId"
Write-Host "  CRF ID: $crfId"
Write-Host "  Rule ID: $ruleId"
Write-Host "  Subject ID: $studySubjectId"
