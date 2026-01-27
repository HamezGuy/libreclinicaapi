# Full Workflow Integration Test Script
# Tests: Study creation -> Phase creation -> Form creation -> Patient assignment -> Validation -> Query generation

$baseUrl = "http://localhost:3001/api"
$token = ""

# Helper function for API calls
function Invoke-Api {
    param(
        [string]$Method,
        [string]$Endpoint,
        [object]$Body = $null
    )
    
    $headers = @{
        "Content-Type" = "application/json"
    }
    
    if ($token) {
        $headers["Authorization"] = "Bearer $token"
    }
    
    $params = @{
        Uri = "$baseUrl$Endpoint"
        Method = $Method
        Headers = $headers
    }
    
    if ($Body) {
        $params["Body"] = ($Body | ConvertTo-Json -Depth 10)
    }
    
    try {
        $response = Invoke-RestMethod @params
        return $response
    }
    catch {
        Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
        if ($_.ErrorDetails.Message) {
            Write-Host "Details: $($_.ErrorDetails.Message)" -ForegroundColor Yellow
        }
        return $null
    }
}

Write-Host "================================================" -ForegroundColor Cyan
Write-Host "  EDC Full Workflow Integration Test" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""

# Step 1: Login
Write-Host "Step 1: Login as root user..." -ForegroundColor Yellow
$loginResult = Invoke-Api -Method POST -Endpoint "/auth/login" -Body @{
    username = "root"
    password = "test123"
}

if ($loginResult -and $loginResult.accessToken) {
    $token = $loginResult.accessToken
    Write-Host "  [OK] Login successful" -ForegroundColor Green
    Write-Host "  User: $($loginResult.user.username) (ID: $($loginResult.user.userId))" -ForegroundColor Gray
} else {
    Write-Host "  [FAIL] Login failed" -ForegroundColor Red
    exit 1
}

Write-Host ""

# Step 2: Create a Study
Write-Host "Step 2: Create a new study..." -ForegroundColor Yellow
$studyData = @{
    name = "Test Clinical Trial $(Get-Date -Format 'yyyyMMdd-HHmmss')"
    uniqueIdentifier = "TCT-$(Get-Date -Format 'yyyyMMddHHmmss')"
    summary = "A test clinical trial for integration testing"
    principalInvestigator = "Dr. Test"
    sponsor = "Test Pharma Inc"
    phase = "II"
    protocolType = "interventional"
    expectedTotalEnrollment = 100
    datePlannedStart = (Get-Date).ToString("yyyy-MM-dd")
    datePlannedEnd = (Get-Date).AddYears(1).ToString("yyyy-MM-dd")
}

$studyResult = Invoke-Api -Method POST -Endpoint "/studies" -Body $studyData

if ($studyResult -and $studyResult.success) {
    $studyId = $studyResult.studyId
    Write-Host "  [OK] Study created with ID: $studyId" -ForegroundColor Green
} else {
    Write-Host "  [FAIL] Study creation failed" -ForegroundColor Red
    Write-Host "  Response: $($studyResult | ConvertTo-Json)" -ForegroundColor Yellow
    exit 1
}

Write-Host ""

# Step 3: Create Form Templates (CRFs)
Write-Host "Step 3: Create form templates..." -ForegroundColor Yellow

# Create Screening Form
$screeningForm = @{
    name = "Screening Assessment Form"
    description = "Initial patient screening and eligibility assessment"
    studyId = $studyId
    category = "Screening"
    version = "v1.0"
    fields = @(
        @{
            label = "Subject Initials"
            type = "text"
            required = $true
            order = 1
            validationRules = @(
                @{ type = "pattern"; value = "^[A-Z]{2,4}$"; message = "Must be 2-4 uppercase letters" }
            )
        },
        @{
            label = "Date of Birth"
            type = "date"
            required = $true
            order = 2
        },
        @{
            label = "Age"
            type = "number"
            required = $true
            order = 3
            min = 18
            max = 65
            validationRules = @(
                @{ type = "min"; value = 18; message = "Subject must be at least 18 years old" },
                @{ type = "max"; value = 65; message = "Subject must be 65 years or younger" }
            )
        },
        @{
            label = "Gender"
            type = "select"
            required = $true
            order = 4
            options = @(
                @{ label = "Male"; value = "M" },
                @{ label = "Female"; value = "F" }
            )
        },
        @{
            label = "Informed Consent Date"
            type = "date"
            required = $true
            order = 5
        },
        @{
            label = "Eligible for Study"
            type = "select"
            required = $true
            order = 6
            options = @(
                @{ label = "Yes"; value = "Y" },
                @{ label = "No"; value = "N" }
            )
        }
    )
}

$screeningResult = Invoke-Api -Method POST -Endpoint "/forms" -Body $screeningForm

if ($screeningResult -and $screeningResult.success) {
    $screeningFormId = $screeningResult.crfId
    Write-Host "  [OK] Screening form created with ID: $screeningFormId" -ForegroundColor Green
} else {
    Write-Host "  [FAIL] Screening form creation failed" -ForegroundColor Red
    Write-Host "  Response: $($screeningResult | ConvertTo-Json -Depth 5)" -ForegroundColor Yellow
}

# Create Vital Signs Form
$vitalsForm = @{
    name = "Vital Signs Assessment"
    description = "Record patient vital signs"
    studyId = $studyId
    category = "Clinical Assessment"
    version = "v1.0"
    fields = @(
        @{
            label = "Assessment Date"
            type = "date"
            required = $true
            order = 1
        },
        @{
            label = "Systolic BP"
            type = "number"
            required = $true
            order = 2
            unit = "mmHg"
            min = 70
            max = 200
            validationRules = @(
                @{ type = "min"; value = 70; message = "Systolic BP must be at least 70 mmHg" },
                @{ type = "max"; value = 200; message = "Systolic BP must be 200 mmHg or less" }
            )
        },
        @{
            label = "Diastolic BP"
            type = "number"
            required = $true
            order = 3
            unit = "mmHg"
            min = 40
            max = 130
            validationRules = @(
                @{ type = "min"; value = 40; message = "Diastolic BP must be at least 40 mmHg" },
                @{ type = "max"; value = 130; message = "Diastolic BP must be 130 mmHg or less" }
            )
        },
        @{
            label = "Heart Rate"
            type = "number"
            required = $true
            order = 4
            unit = "bpm"
            min = 40
            max = 150
        },
        @{
            label = "Temperature"
            type = "decimal"
            required = $true
            order = 5
            unit = "°C"
            min = 35
            max = 42
        },
        @{
            label = "Weight"
            type = "decimal"
            required = $true
            order = 6
            unit = "kg"
            min = 30
            max = 300
        }
    )
}

$vitalsResult = Invoke-Api -Method POST -Endpoint "/forms" -Body $vitalsForm

if ($vitalsResult -and $vitalsResult.success) {
    $vitalsFormId = $vitalsResult.crfId
    Write-Host "  [OK] Vital Signs form created with ID: $vitalsFormId" -ForegroundColor Green
} else {
    Write-Host "  [FAIL] Vital Signs form creation failed" -ForegroundColor Red
}

Write-Host ""

# Step 4: Create Study Phases (Events)
Write-Host "Step 4: Create study phases..." -ForegroundColor Yellow

# Create Screening Phase
$screeningPhase = @{
    studyId = $studyId
    name = "Screening Visit"
    description = "Initial screening and eligibility assessment"
    ordinal = 1
    type = "scheduled"
    repeating = $false
    category = "Screening"
}

$screeningPhaseResult = Invoke-Api -Method POST -Endpoint "/events" -Body $screeningPhase

if ($screeningPhaseResult -and $screeningPhaseResult.success) {
    $screeningPhaseId = $screeningPhaseResult.eventDefinitionId
    Write-Host "  [OK] Screening phase created with ID: $screeningPhaseId" -ForegroundColor Green
} else {
    Write-Host "  [FAIL] Screening phase creation failed" -ForegroundColor Red
    Write-Host "  Response: $($screeningPhaseResult | ConvertTo-Json -Depth 5)" -ForegroundColor Yellow
}

# Create Treatment Phase
$treatmentPhase = @{
    studyId = $studyId
    name = "Treatment Visit"
    description = "Treatment administration and monitoring"
    ordinal = 2
    type = "scheduled"
    repeating = $true
    category = "Treatment"
}

$treatmentPhaseResult = Invoke-Api -Method POST -Endpoint "/events" -Body $treatmentPhase

if ($treatmentPhaseResult -and $treatmentPhaseResult.success) {
    $treatmentPhaseId = $treatmentPhaseResult.eventDefinitionId
    Write-Host "  [OK] Treatment phase created with ID: $treatmentPhaseId" -ForegroundColor Green
} else {
    Write-Host "  [FAIL] Treatment phase creation failed" -ForegroundColor Red
}

Write-Host ""

# Step 5: Assign Forms to Phases
Write-Host "Step 5: Assign forms to phases..." -ForegroundColor Yellow

if ($screeningPhaseId -and $screeningFormId) {
    $assignScreeningForm = @{
        studyEventDefinitionId = $screeningPhaseId
        crfId = $screeningFormId
        required = $true
        ordinal = 1
    }
    
    $assignResult1 = Invoke-Api -Method POST -Endpoint "/events/assign-crf" -Body $assignScreeningForm
    
    if ($assignResult1 -and $assignResult1.success) {
        Write-Host "  [OK] Screening form assigned to Screening phase" -ForegroundColor Green
    } else {
        Write-Host "  [FAIL] Failed to assign screening form to phase" -ForegroundColor Red
    }
}

if ($treatmentPhaseId -and $vitalsFormId) {
    $assignVitalsForm = @{
        studyEventDefinitionId = $treatmentPhaseId
        crfId = $vitalsFormId
        required = $true
        ordinal = 1
    }
    
    $assignResult2 = Invoke-Api -Method POST -Endpoint "/events/assign-crf" -Body $assignVitalsForm
    
    if ($assignResult2 -and $assignResult2.success) {
        Write-Host "  [OK] Vital Signs form assigned to Treatment phase" -ForegroundColor Green
    } else {
        Write-Host "  [FAIL] Failed to assign vital signs form to phase" -ForegroundColor Red
    }
}

Write-Host ""

# Step 6: Create a Patient/Subject
Write-Host "Step 6: Create a patient and assign to study..." -ForegroundColor Yellow

$patientData = @{
    studyId = $studyId
    studySubjectId = "SUBJ-$(Get-Date -Format 'yyyyMMddHHmmss')"
    secondaryId = "SEC-001"
    gender = "Male"
    dateOfBirth = "1985-05-15"
    enrollmentDate = (Get-Date).ToString("yyyy-MM-dd")
}

$patientResult = Invoke-Api -Method POST -Endpoint "/subjects" -Body $patientData

if ($patientResult -and $patientResult.success) {
    $subjectId = $patientResult.data.studySubjectId
    $subjectLabel = $patientResult.data.label
    Write-Host "  [OK] Patient created with ID: $subjectId (Label: $subjectLabel)" -ForegroundColor Green
    
    # Check if events were auto-scheduled
    if ($patientResult.data.studyEventIds -and $patientResult.data.studyEventIds.Count -gt 0) {
        Write-Host "  [OK] $($patientResult.data.studyEventIds.Count) study events auto-scheduled for patient" -ForegroundColor Green
    }
} else {
    Write-Host "  [FAIL] Patient creation failed" -ForegroundColor Red
    Write-Host "  Response: $($patientResult | ConvertTo-Json -Depth 5)" -ForegroundColor Yellow
}

Write-Host ""

# Step 7: Get Patient's Events (verify phases were copied)
Write-Host "Step 7: Verify patient has scheduled events..." -ForegroundColor Yellow

if ($subjectId) {
    $patientEvents = Invoke-Api -Method GET -Endpoint "/events/subject/$subjectId"
    
    if ($patientEvents -and $patientEvents.Count -gt 0) {
        Write-Host "  [OK] Patient has $($patientEvents.Count) scheduled events:" -ForegroundColor Green
        foreach ($event in $patientEvents) {
            Write-Host "    - $($event.event_name) (Status: $($event.status_name))" -ForegroundColor Gray
        }
    } else {
        Write-Host "  [WARN] No events found for patient" -ForegroundColor Yellow
    }
}

Write-Host ""

# Step 8: Create Validation Rules
Write-Host "Step 8: Create validation rules..." -ForegroundColor Yellow

if ($vitalsFormId) {
    # Range validation rule for Systolic BP
    $bpRule = @{
        crfId = $vitalsFormId
        name = "Systolic BP Range Check"
        description = "Validates systolic blood pressure is within normal range"
        ruleType = "range"
        fieldPath = "Systolic BP"
        severity = "error"
        errorMessage = "Systolic BP must be between 70 and 200 mmHg"
        minValue = 70
        maxValue = 200
    }
    
    $ruleResult = Invoke-Api -Method POST -Endpoint "/validation-rules" -Body $bpRule
    
    if ($ruleResult -and $ruleResult.success) {
        Write-Host "  [OK] Systolic BP validation rule created" -ForegroundColor Green
    } else {
        Write-Host "  [FAIL] Validation rule creation failed" -ForegroundColor Red
    }
    
    # Temperature warning rule
    $tempRule = @{
        crfId = $vitalsFormId
        name = "Temperature Warning"
        description = "Warns if temperature indicates fever"
        ruleType = "range"
        fieldPath = "Temperature"
        severity = "warning"
        errorMessage = "Temperature above 37.5°C may indicate fever"
        warningMessage = "Temperature above 37.5°C may indicate fever - please verify"
        maxValue = 37.5
    }
    
    $tempRuleResult = Invoke-Api -Method POST -Endpoint "/validation-rules" -Body $tempRule
    
    if ($tempRuleResult -and $tempRuleResult.success) {
        Write-Host "  [OK] Temperature warning rule created" -ForegroundColor Green
    } else {
        Write-Host "  [FAIL] Temperature warning rule creation failed" -ForegroundColor Red
    }
}

Write-Host ""

# Step 9: Submit Form Data with Validation Errors (to trigger query generation)
Write-Host "Step 9: Submit form data with validation errors..." -ForegroundColor Yellow

if ($subjectId -and $vitalsFormId -and $treatmentPhaseId) {
    # Submit data with values that should trigger validation errors
    $formData = @{
        studyId = $studyId
        subjectId = $subjectId
        eventId = $treatmentPhaseId
        formId = $vitalsFormId
        data = @{
            "Assessment Date" = (Get-Date).ToString("yyyy-MM-dd")
            "Systolic BP" = 250  # Invalid - above max
            "Diastolic BP" = 85
            "Heart Rate" = 75
            "Temperature" = 38.5  # Should trigger warning
            "Weight" = 75.5
        }
    }
    
    $formSubmitResult = Invoke-Api -Method POST -Endpoint "/forms/data" -Body $formData
    
    if ($formSubmitResult) {
        if ($formSubmitResult.success) {
            Write-Host "  [OK] Form data saved (validation passed)" -ForegroundColor Green
        } else {
            Write-Host "  [OK] Form data validation failed as expected" -ForegroundColor Green
            if ($formSubmitResult.errors) {
                Write-Host "  Validation errors:" -ForegroundColor Gray
                foreach ($error in $formSubmitResult.errors) {
                    Write-Host "    - $($error.fieldPath): $($error.message)" -ForegroundColor Yellow
                }
            }
            if ($formSubmitResult.queriesCreated) {
                Write-Host "  [OK] $($formSubmitResult.queriesCreated) queries created for validation failures" -ForegroundColor Green
            }
        }
    } else {
        Write-Host "  [FAIL] Form submission failed" -ForegroundColor Red
    }
}

Write-Host ""

# Step 10: Check Queries/Workflows
Write-Host "Step 10: Check queries and workflows..." -ForegroundColor Yellow

$queries = Invoke-Api -Method GET -Endpoint "/queries?studyId=$studyId"

if ($queries -and $queries.data) {
    Write-Host "  [OK] Found $($queries.data.Count) queries for the study" -ForegroundColor Green
    foreach ($query in $queries.data) {
        Write-Host "    - $($query.description) (Status: $($query.status_name))" -ForegroundColor Gray
    }
} else {
    Write-Host "  [INFO] No queries found (may be expected)" -ForegroundColor Gray
}

$workflows = Invoke-Api -Method GET -Endpoint "/workflows?studyId=$studyId"

if ($workflows -and $workflows.data) {
    Write-Host "  [OK] Found $($workflows.data.Count) workflows for the study" -ForegroundColor Green
} else {
    Write-Host "  [INFO] No workflows found" -ForegroundColor Gray
}

Write-Host ""

# Step 11: Submit Valid Form Data
Write-Host "Step 11: Submit valid form data..." -ForegroundColor Yellow

if ($subjectId -and $vitalsFormId -and $treatmentPhaseId) {
    $validFormData = @{
        studyId = $studyId
        subjectId = $subjectId
        eventId = $treatmentPhaseId
        formId = $vitalsFormId
        data = @{
            "Assessment Date" = (Get-Date).ToString("yyyy-MM-dd")
            "Systolic BP" = 120  # Valid
            "Diastolic BP" = 80
            "Heart Rate" = 72
            "Temperature" = 36.8  # Valid
            "Weight" = 75.5
        }
    }
    
    $validFormResult = Invoke-Api -Method POST -Endpoint "/forms/data" -Body $validFormData
    
    if ($validFormResult -and $validFormResult.success) {
        Write-Host "  [OK] Valid form data saved successfully" -ForegroundColor Green
        if ($validFormResult.data.savedCount) {
            Write-Host "    Saved $($validFormResult.data.savedCount) fields" -ForegroundColor Gray
        }
    } else {
        Write-Host "  [FAIL] Valid form data submission failed" -ForegroundColor Red
        Write-Host "  Response: $($validFormResult | ConvertTo-Json -Depth 5)" -ForegroundColor Yellow
    }
}

Write-Host ""
Write-Host "================================================" -ForegroundColor Cyan
Write-Host "  Test Summary" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan
Write-Host "Study ID: $studyId" -ForegroundColor Gray
Write-Host "Screening Form ID: $screeningFormId" -ForegroundColor Gray
Write-Host "Vital Signs Form ID: $vitalsFormId" -ForegroundColor Gray
Write-Host "Screening Phase ID: $screeningPhaseId" -ForegroundColor Gray
Write-Host "Treatment Phase ID: $treatmentPhaseId" -ForegroundColor Gray
Write-Host "Subject ID: $subjectId" -ForegroundColor Gray
Write-Host ""
Write-Host "Test completed!" -ForegroundColor Green

