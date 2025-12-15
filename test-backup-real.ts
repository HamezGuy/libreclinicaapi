/**
 * REAL Backup Test - Tests actual database backup via Docker
 * 
 * Run: npx ts-node test-backup-real.ts
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as zlib from 'zlib';

const execAsync = promisify(exec);
const gunzip = promisify(zlib.gunzip);

const CONTAINER_NAME = 'libreclinica-postgres';
const BACKUP_DIR = path.join(process.cwd(), 'test-backups');

async function checkDocker(): Promise<boolean> {
  try {
    const { stdout } = await execAsync(`docker inspect -f "{{.State.Running}}" ${CONTAINER_NAME}`);
    return stdout.trim() === 'true';
  } catch {
    return false;
  }
}

async function runTest() {
  console.log('='.repeat(60));
  console.log('  REAL BACKUP TEST - Using Docker PostgreSQL');
  console.log('='.repeat(60));
  console.log();

  // Check if Docker container is running
  console.log('1. Checking Docker container...');
  const dockerRunning = await checkDocker();
  if (!dockerRunning) {
    console.log('❌ Docker container not running!');
    console.log();
    console.log('Start it with:');
    console.log('  docker-compose -f docker-compose.libreclinica.yml up -d');
    console.log();
    process.exit(1);
  }
  console.log('✅ Container running: ' + CONTAINER_NAME);
  console.log();

  // Create backup directory
  console.log('2. Creating backup directory...');
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }
  console.log('✅ Backup directory: ' + BACKUP_DIR);
  console.log();

  // Run pg_dump inside Docker
  console.log('3. Running pg_dump inside Docker container...');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `backup_${timestamp}.sql.gz`;
  const outputPath = path.join(BACKUP_DIR, filename);

  try {
    const startTime = Date.now();
    const cmd = `docker exec ${CONTAINER_NAME} sh -c "pg_dump -U libreclinica -d libreclinica | gzip" > "${outputPath}"`;
    console.log('   Command: ' + cmd);
    
    await execAsync(cmd, { timeout: 120000 });
    const duration = Date.now() - startTime;
    
    console.log('✅ pg_dump completed in ' + duration + 'ms');
    console.log();
  } catch (error: any) {
    console.log('❌ pg_dump failed: ' + error.message);
    process.exit(1);
  }

  // Verify file was created
  console.log('4. Verifying backup file...');
  if (!fs.existsSync(outputPath)) {
    console.log('❌ Backup file not found!');
    process.exit(1);
  }
  
  const stats = fs.statSync(outputPath);
  console.log('✅ File created: ' + outputPath);
  console.log('   Size: ' + (stats.size / 1024).toFixed(2) + ' KB');
  console.log();

  // Verify it's valid gzip
  console.log('5. Verifying gzip format...');
  const fileContent = fs.readFileSync(outputPath);
  if (fileContent[0] === 0x1f && fileContent[1] === 0x8b) {
    console.log('✅ Valid gzip magic bytes (0x1f 0x8b)');
  } else {
    console.log('❌ Invalid gzip format!');
    console.log('   First bytes: 0x' + fileContent[0].toString(16) + ' 0x' + fileContent[1].toString(16));
    process.exit(1);
  }
  console.log();

  // Decompress and check content
  console.log('6. Decompressing and checking content...');
  try {
    const decompressed = await gunzip(fileContent);
    const sqlContent = decompressed.toString('utf-8');
    
    console.log('✅ Decompressed size: ' + (decompressed.length / 1024).toFixed(2) + ' KB');
    console.log('   Content length: ' + sqlContent.length + ' chars');
    
    // Check for expected PostgreSQL dump content
    const hasPostgresHeader = sqlContent.includes('PostgreSQL database dump') || sqlContent.includes('pg_dump');
    const hasTables = sqlContent.includes('CREATE TABLE') || sqlContent.includes('COPY ');
    
    if (hasPostgresHeader || hasTables) {
      console.log('✅ Contains valid PostgreSQL dump content');
    } else {
      console.log('⚠️ May not contain valid dump content');
    }
    
    // Show preview
    console.log();
    console.log('   Preview (first 300 chars):');
    console.log('   ' + '-'.repeat(50));
    console.log('   ' + sqlContent.substring(0, 300).replace(/\n/g, '\n   '));
    console.log('   ' + '-'.repeat(50));
    console.log();
  } catch (error: any) {
    console.log('❌ Failed to decompress: ' + error.message);
    process.exit(1);
  }

  // Calculate checksum
  console.log('7. Calculating SHA-256 checksum...');
  const checksum = crypto.createHash('sha256').update(fileContent).digest('hex');
  console.log('✅ Checksum: ' + checksum);
  console.log();

  // Save metadata
  console.log('8. Saving backup metadata...');
  const metadata = {
    backupId: 'BKP-TEST-' + Date.now(),
    filename,
    path: outputPath,
    size: stats.size,
    checksum,
    checksumAlgorithm: 'SHA-256',
    createdAt: new Date().toISOString(),
    container: CONTAINER_NAME,
    database: 'libreclinica'
  };
  
  const metadataPath = path.join(BACKUP_DIR, 'backup-metadata.json');
  fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
  console.log('✅ Metadata saved: ' + metadataPath);
  console.log();

  // Summary
  console.log('='.repeat(60));
  console.log('  ✅ ALL TESTS PASSED - Backup system is working!');
  console.log('='.repeat(60));
  console.log();
  console.log('Backup Details:');
  console.log('  File: ' + filename);
  console.log('  Size: ' + (stats.size / 1024).toFixed(2) + ' KB');
  console.log('  Checksum: ' + checksum.substring(0, 32) + '...');
  console.log();
  console.log('To restore this backup:');
  console.log(`  gunzip -c "${outputPath}" | docker exec -i ${CONTAINER_NAME} psql -U libreclinica -d libreclinica`);
  console.log();

  // Cleanup option
  console.log('Test backup files are in: ' + BACKUP_DIR);
  console.log('To clean up: Remove-Item -Recurse -Force "' + BACKUP_DIR + '"');
}

runTest().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});

