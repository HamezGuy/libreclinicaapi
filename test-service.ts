// Test the backup service
process.env.BACKUP_DIR = './service-test-backups';
process.env.BACKUP_CONTAINER = 'libreclinica-postgres';

import { performBackup, listBackups, verifyBackup, getBackupStats, BackupType } from './src/services/backup/backup.service';

async function test() {
  console.log('Testing backup service...\n');
  
  // Create backup
  console.log('1. Creating full backup...');
  const result = await performBackup(BackupType.FULL, 1, 'test-user');
  console.log('   Result:', result.success ? '✅ SUCCESS' : '❌ FAILED');
  console.log('   Message:', result.message);
  
  if (result.success && result.data) {
    console.log('   Backup ID:', result.data.backupId);
    console.log('   Size:', (result.data.backupSize / 1024).toFixed(2), 'KB');
    console.log('   Duration:', result.data.backupDuration, 'ms');
    console.log('   Checksum:', result.data.checksum.substring(0, 32) + '...');
    console.log();
    
    // List backups
    console.log('2. Listing backups...');
    const list = await listBackups();
    console.log('   Total backups:', list.data?.length || 0);
    console.log();
    
    // Verify backup
    console.log('3. Verifying backup...');
    const verify = await verifyBackup(result.data.backupId, 1, 'test');
    console.log('   Verification:', verify.data?.verified ? '✅ PASSED' : '❌ FAILED');
    console.log();
    
    // Get stats
    console.log('4. Getting backup stats...');
    const stats = await getBackupStats();
    if (stats.success && stats.data) {
      console.log('   Total backups:', stats.data.totalBackups);
      console.log('   Total size:', (stats.data.totalSize / 1024).toFixed(2), 'KB');
      console.log('   Health:', stats.data.status.healthy ? '✅ Healthy' : '⚠️ Warnings');
    }
    
    console.log('\n✅ All backup service tests passed!');
  } else {
    console.log('\n❌ Backup failed:', result.data?.error || result.message);
  }
  
  process.exit(0);
}

test().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});

