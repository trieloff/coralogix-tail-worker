#!/usr/bin/env node

/**
 * Test script to validate Coralogix Tail Worker setup
 *
 * This script checks if all required configuration is in place
 * and optionally sends a test log to Coralogix.
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

console.log('🧪 Testing Coralogix Tail Worker Setup\n');

// Test 1: Check if wrangler is installed
console.log('1. Checking Wrangler CLI...');
try {
  const version = execSync('wrangler --version', { encoding: 'utf8' }).trim();
  console.log(`   ✅ Wrangler installed: ${version}`);
} catch (error) {
  console.log('   ❌ Wrangler CLI not found. Please install it:');
  console.log('      npm install -g wrangler');
  process.exit(1);
}

// Test 2: Check if user is authenticated
console.log('\n2. Checking Cloudflare authentication...');
try {
  const whoami = execSync('wrangler whoami', { encoding: 'utf8' }).trim();
  console.log(`   ✅ Authenticated: ${whoami}`);
} catch (error) {
  console.log('   ❌ Not authenticated. Please run:');
  console.log('      wrangler login');
  process.exit(1);
}

// Test 3: Check required secrets
console.log('\n3. Checking required secrets...');
try {
  const secrets = execSync('wrangler secret list', { encoding: 'utf8' });

  const requiredSecrets = ['CORALOGIX_API_KEY'];
  const missingSecrets = [];

  for (const secret of requiredSecrets) {
    if (secrets.includes(secret)) {
      console.log(`   ✅ ${secret} is configured`);
    } else {
      console.log(`   ❌ ${secret} is missing`);
      missingSecrets.push(secret);
    }
  }

  if (missingSecrets.length > 0) {
    console.log('\n   Please set the missing secrets:');
    for (const secret of missingSecrets) {
      console.log(`   wrangler secret put ${secret}`);
    }
    process.exit(1);
  }
  
} catch (error) {
  console.log('   ❌ Failed to check secrets');
  console.log('   Error:', error.message);
  process.exit(1);
}

// Test 4: Validate wrangler.toml
console.log('\n4. Checking wrangler.toml configuration...');

const wranglerPath = path.join(process.cwd(), 'wrangler.toml');
if (fs.existsSync(wranglerPath)) {
  const config = fs.readFileSync(wranglerPath, 'utf8');
  
  if (config.includes('name = "coralogix-tail-worker"')) {
    console.log('   ✅ Worker name configured correctly');
  } else {
    console.log('   ❌ Worker name not found in wrangler.toml');
  }
  
  if (config.includes('main = "src/index.js"')) {
    console.log('   ✅ Main script path configured correctly');
  } else {
    console.log('   ❌ Main script path not configured correctly');
  }

  if (config.includes('CORALOGIX_ENDPOINT')) {
    console.log('   ✅ Coralogix endpoint configured');
  } else {
    console.log('   ❌ Coralogix endpoint not configured');
  }

  if (config.includes('APPLICATION_NAME')) {
    console.log('   ✅ Application name configured');
  } else {
    console.log('   ❌ Application name not configured');
  }
  
} else {
  console.log('   ❌ wrangler.toml not found');
  process.exit(1);
}

// Test 5: Check if main script exists
console.log('\n5. Checking main script...');
const mainScriptPath = path.join(process.cwd(), 'src', 'index.js');
if (fs.existsSync(mainScriptPath)) {
  console.log('   ✅ Main script exists: src/index.js');
  
  const script = fs.readFileSync(mainScriptPath, 'utf8');
  if (script.includes('async tail(events, env, ctx)')) {
    console.log('   ✅ Tail handler function found');
  } else {
    console.log('   ❌ Tail handler function not found');
  }
} else {
  console.log('   ❌ Main script not found: src/index.js');
  process.exit(1);
}

// Test 6: Optional - Test deployment (dry run)
console.log('\n6. Testing deployment (dry run)...');
try {
  execSync('wrangler deploy --dry-run', { encoding: 'utf8', stdio: 'pipe' });
  console.log('   ✅ Deployment configuration is valid');
} catch (error) {
  console.log('   ⚠️  Deployment dry run failed:');
  console.log('      ', error.message.split('\n')[0]);
}

console.log('\n🎉 Setup validation completed!');
console.log('\nNext steps:');
console.log('1. Deploy the worker: npm run deploy:staging');
console.log('2. Configure source workers to use this tail worker');
console.log('3. Test by generating logs in your source workers');
console.log('4. Check Coralogix for incoming logs');


