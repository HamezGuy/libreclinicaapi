# SOAP Testing Infrastructure

This directory contains mock implementations for testing LibreClinica SOAP services without requiring a real SOAP server.

## Components

### 1. Mock SOAP Server (`soap-mock-server.ts`)
A standalone HTTP server that simulates LibreClinica SOAP Web Services:
- **Study Service** (`/ws/study/v1`) - Study metadata operations
- **StudySubject Service** (`/ws/studySubject/v1`) - Subject enrollment
- **Event Service** (`/ws/event/v1`) - Event scheduling
- **Data Service** (`/ws/data/v1`) - Clinical data import

### 2. Mock SOAP Client (`soap-mock-client.ts`)
A mock implementation of the SOAP client for unit testing:
- No network calls required
- Configurable responses
- Failure simulation

## Running SOAP Tests

### Unit Tests (No Server Required)
```bash
# Run SOAP service unit tests (uses mock client)
npm run test:soap
```

### Integration Tests (Uses Mock Server)
```bash
# Run SOAP integration tests (auto-starts mock server)
npm run test:soap:integration
```

### All SOAP Tests
```bash
npm run test:soap:all
```

## Configuration

### Environment Variables
| Variable | Description | Default |
|----------|-------------|---------|
| `USE_MOCK_SOAP` | Enable mock SOAP server | `true` |
| `MOCK_SOAP_PORT` | Port for mock server | `8089` |
| `LIBRECLINICA_SOAP_URL` | SOAP endpoint URL | Auto-configured |

### Disabling Mocks
To test against a real LibreClinica instance:
```bash
USE_MOCK_SOAP=false LIBRECLINICA_SOAP_URL=http://your-server:8080/LibreClinica/ws npm run test:soap:integration
```

## Usage in Tests

### Unit Tests (Direct Mock Client)
```typescript
import { MockSoapClient } from './mocks/soap-mock-client';

const mockClient = new MockSoapClient();

// Configure mock behavior
mockClient.setResponseOverride('study.getMetadata', { odm: '<ODM>...</ODM>' });
mockClient.setFailMode(true, 'Connection failed');

// Test your service
const result = await myService.doSomething();
```

### Integration Tests (Mock Server)
```typescript
import { setupSoapTests, teardownSoapTests, addMockStudy } from './setup/soap-test-setup';

beforeAll(async () => {
  await setupSoapTests();
  addMockStudy('S_1', 'Test Study');
});

afterAll(async () => {
  await teardownSoapTests();
});

it('should work with mock server', async () => {
  // Your test using real HTTP calls to mock server
});
```

## Mock Data Store

The mock server maintains in-memory data that can be manipulated:

```typescript
import { getMockSoapServer } from './setup/soap-test-setup';

const server = getMockSoapServer();

// Add test data
server.addStudy({
  oid: 'S_TEST',
  identifier: 'TEST-STUDY',
  name: 'My Test Study',
  description: 'For testing',
  status: 'available'
});

server.addSubject({
  subjectKey: 'SS_1',
  studySubjectId: 'SUBJ-001',
  studyOid: 'S_TEST',
  enrollmentDate: '2024-01-15'
});

// Reset between tests
server.reset();
```

## Extending Mock Responses

### Custom Study Metadata
```typescript
import { mockSoapClient } from './mocks/soap-mock-client';

const customMetadata = `<?xml version="1.0"?>
<ODM>
  <Study OID="S_CUSTOM">
    <GlobalVariables>
      <StudyName>Custom Study</StudyName>
    </GlobalVariables>
  </Study>
</ODM>`;

mockSoapClient.setResponseOverride('study.getMetadata', { odm: customMetadata });
```

### Simulating Errors
```typescript
// Network error
mockSoapClient.setFailMode(true, 'ECONNREFUSED');

// Authentication error
mockSoapClient.setFailMode(true, 'Authentication failed: Invalid credentials');

// Validation error
mockSoapClient.setResponseOverride('data.importODM', {
  result: 'ValidationError',
  validationErrors: [{ itemOid: 'I_AGE', message: 'Value out of range' }]
});
```

## Debugging

Enable verbose logging:
```bash
DEBUG=soap:* npm run test:soap
```

## Common Issues

### Port Already in Use
If port 8089 is occupied:
```bash
MOCK_SOAP_PORT=8090 npm run test:soap:all
```

### Tests Hanging
The mock server is automatically started/stopped by Jest global setup/teardown. If tests hang:
1. Check for unresolved promises in your tests
2. Ensure `forceExit: true` is set in jest.config.js
3. Use `--detectOpenHandles` to find the issue

### Real Server Testing
To test against real LibreClinica:
1. Ensure LibreClinica is running at the configured URL
2. Set `USE_MOCK_SOAP=false`
3. Configure `LIBRECLINICA_SOAP_URL` appropriately

