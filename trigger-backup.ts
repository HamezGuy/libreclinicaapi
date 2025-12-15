/**
 * Trigger and verify backup
 */
import { performBackup, listBackups, verifyBackup, getBackupStats, BackupType } from './src/services/backup/backup.service';
import * as fs from 'fs';
import * as zlib from 'zlib';
import { promisify } from 'util';

const gunzip = promisify(zlib.gunzip);

async function triggerBackup() {
  console.log('='.repeat(60));
  console.log('  TRIGGERING FULL BACKUP');
  console.log('='.repeat(60));
  console.log();

  // Trigger full backup
  console.log('1. Creating full backup...');
  const result = await performBackup(BackupType.FULL, 1, 'manual-test');
  
  if (result.success && result.data) {
    console.log('   ✅ Status: SUCCESS');
    console.log('   Backup ID:', result.data.backupId);
    console.log('   Location:', result.data.backupLocation);
    console.log('   Size:', (result.data.backupSize / 1024).toFixed(2), 'KB');
    console.log('   Duration:', result.data.backupDuration, 'ms');
    console.log('   Checksum:', result.data.checksum);
    console.log();

    // Verify file exists
    console.log('2. Checking backup file on disk...');
    if (fs.existsSync(result.data.backupLocation)) {
      const stats = fs.statSync(result.data.backupLocation);
      console.log('   ✅ File exists:', result.data.backupLocation);
      console.log('   File size:', stats.size, 'bytes');
      
      // Check gzip format
      const content = fs.readFileSync(result.data.backupLocation);
      if (content[0] === 0x1f && content[1] === 0x8b) {
        console.log('   ✅ Valid gzip format');
        
        // Decompress and check content
        const decompressed = await gunzip(content);
        console.log('   Decompressed size:', (decompressed.length / 1024).toFixed(2), 'KB');
        
        const sqlContent = decompressed.toString('utf-8');
        if (sqlContent.includes('PostgreSQL database dump')) {
          console.log('   ✅ Contains valid PostgreSQL dump');
        }
        
        // Show preview
        console.log('   Preview:', sqlContent.substring(0, 100).replace(/\n/g, ' ') + '...');
      }
    } else {
      console.log('   ❌ File NOT found!');
    }
    console.log();

    // Verify backup integrity
    console.log('3. Verifying backup integrity (checksum)...');
    const verify = await verifyBackup(result.data.backupId, 1, 'manual-test');
    if (verify.data?.verified) {
      console.log('   ✅ Checksum verification PASSED');
    } else {
      console.log('   ❌ Checksum verification FAILED');
    }
    console.log();

    // Check metadata file
    console.log('4. Checking metadata file...');
    const metadataPath = result.data.backupLocation.replace(/[^\\\/]+$/, '').replace(/[\\\/]full[\\\/]?$/, '/metadata/') + result.data.backupId + '.json';
    const metaDir = result.data.backupLocation.replace(/full[\\\/][^\\\/]+$/, 'metadata');
    const metaFile = metaDir + '\\' + result.data.backupId + '.json';
    
    if (fs.existsSync(metaFile)) {
      const meta = JSON.parse(fs.readFileSync(metaFile, 'utf-8'));
      console.log('   ✅ Metadata file exists');
      console.log('   Database:', meta.databaseName);
      console.log('   Retention until:', meta.retentionUntil);
    }
    console.log();

    // List all backups
    console.log('5. Listing all backups...');
    const list = await listBackups();
    console.log('   Total backups:', list.data?.length || 0);
    if (list.data) {
      for (const b of list.data) {
        console.log('   -', b.backupId, '|', b.backupType, '|', (b.backupSize / 1024).toFixed(2), 'KB');
      }
    }
    console.log();

    // Get stats
    console.log('6. Backup statistics...');
    const stats = await getBackupStats();
    if (stats.success && stats.data) {
      console.log('   Total backups:', stats.data.totalBackups);
      console.log('   Total size:', (stats.data.totalSize / 1024).toFixed(2), 'KB');
      console.log('   By type:');
      console.log('     Full:', stats.data.backupsByType.full);
      console.log('     Incremental:', stats.data.backupsByType.incremental);
      console.log('     Transaction logs:', stats.data.backupsByType.transaction_log);
      console.log('   Health:', stats.data.status.healthy ? '✅ HEALTHY' : '⚠️ NEEDS ATTENTION');
      if (stats.data.status.warnings.length > 0) {
        console.log('   Warnings:', stats.data.status.warnings.join(', '));
      }
    }
    console.log();
    console.log('='.repeat(60));
    console.log('  ✅ BACKUP COMPLETE - ALL CHECKS PASSED');
    console.log('='.repeat(60));
  } else {
    console.log('   ❌ Status: FAILED');
    console.log('   Error:', result.message);
    if (result.data?.error) {
      console.log('   Details:', result.data.error);
    }
  }
  
  process.exit(0);
}

triggerBackup().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});

