#!/usr/bin/env node
import { existsSync, readFileSync } from 'fs';
import { config } from 'dotenv';

console.log('🔍 Verifying Scheduled Job Generator Setup...\n');

const checks = {
  passed: 0,
  failed: 0,
  warnings: 0
};

function checkFile(path, description) {
  if (existsSync(path)) {
    console.log(`✅ ${description}`);
    checks.passed++;
    return true;
  } else {
    console.log(`❌ ${description} - Missing: ${path}`);
    checks.failed++;
    return false;
  }
}

function checkEnv(key, description) {
  if (process.env[key]) {
    console.log(`✅ ${description}: ${process.env[key].substring(0, 20)}...`);
    checks.passed++;
    return true;
  } else {
    console.log(`❌ ${description} - Not found in environment`);
    checks.failed++;
    return false;
  }
}

// Check files
console.log('📁 Checking Files:\n');
checkFile('./generate-rotated-jobs.mjs', 'Main generation script');
checkFile('./package.json', 'Package configuration');
checkFile('./rotation-state.json', 'Rotation state tracker');
checkFile('./.env.example', 'Environment template');
checkFile('./.gitignore', 'Git ignore file');
checkFile('./README.md', 'Documentation');
checkFile('./.github/workflows/generate-jobs.yml', 'GitHub Actions workflow');

// Check environment
console.log('\n🔑 Checking Environment Variables:\n');
config();

checkEnv('MONGODB_URI', 'MongoDB connection string');
checkEnv('MONGODB_DB_NAME', 'MongoDB database name');

// Accept either OpenAI or Azure OpenAI configuration
const hasOpenAI = !!process.env.OPENAI_API_KEY;
// Support both AZURE_OPENAI_DEPLOYMENT and AZURE_OPENAI_DEPLOYMENT_NAME
const azureDeployment = process.env.AZURE_OPENAI_DEPLOYMENT || process.env.AZURE_OPENAI_DEPLOYMENT_NAME;
const hasAzure = !!(process.env.AZURE_OPENAI_ENDPOINT && process.env.AZURE_OPENAI_API_KEY && azureDeployment);

if (hasOpenAI) {
  checkEnv('OPENAI_API_KEY', 'OpenAI API key');
} else if (hasAzure) {
  checkEnv('AZURE_OPENAI_ENDPOINT', 'Azure OpenAI endpoint');
  checkEnv('AZURE_OPENAI_API_KEY', 'Azure OpenAI API key');
  if (process.env.AZURE_OPENAI_DEPLOYMENT) {
    checkEnv('AZURE_OPENAI_DEPLOYMENT', 'Azure OpenAI deployment name');
  } else {
    checkEnv('AZURE_OPENAI_DEPLOYMENT_NAME', 'Azure OpenAI deployment name');
  }
  // Optional version
  if (process.env.AZURE_OPENAI_API_VERSION) {
    console.log(`✅ Azure OpenAI API version: ${process.env.AZURE_OPENAI_API_VERSION}`);
    checks.passed++;
  } else {
    console.log('ℹ️  Azure OpenAI API version not set, default will be used by the script');
  }
} else {
  console.log('❌ No AI provider configured. Set OPENAI_API_KEY or Azure OpenAI vars (AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_API_KEY, AZURE_OPENAI_DEPLOYMENT)');
  checks.failed++;
}

// Check rotation state
console.log('\n📊 Checking Rotation State:\n');
try {
  const state = JSON.parse(readFileSync('./rotation-state.json', 'utf8'));
  console.log(`✅ Current index: ${state.currentIndex}`);
  console.log(`✅ Total generated: ${state.totalGenerated}`);
  console.log(`✅ Last run: ${state.lastRun || 'Never'}`);
  checks.passed += 3;
} catch (error) {
  console.log(`❌ Failed to read rotation state: ${error.message}`);
  checks.failed++;
}

// Check Node version
console.log('\n🔧 Checking System:\n');
const nodeVersion = process.version;
const major = parseInt(nodeVersion.slice(1).split('.')[0]);
if (major >= 18) {
  console.log(`✅ Node.js version: ${nodeVersion} (>= 18.0.0)`);
  checks.passed++;
} else {
  console.log(`⚠️  Node.js version: ${nodeVersion} (recommended >= 18.0.0)`);
  checks.warnings++;
}

// Check dependencies
console.log('\n📦 Checking Dependencies:\n');
if (existsSync('./node_modules')) {
  console.log('✅ node_modules exists');
  checks.passed++;
  
  const requiredPackages = ['dotenv', 'mongoose', 'openai'];
  for (const pkg of requiredPackages) {
    if (existsSync(`./node_modules/${pkg}`)) {
      console.log(`✅ ${pkg} installed`);
      checks.passed++;
    } else {
      console.log(`❌ ${pkg} not installed`);
      checks.failed++;
    }
  }
} else {
  console.log('⚠️  node_modules not found - Run: npm install');
  checks.warnings++;
}

// Summary
console.log('\n' + '='.repeat(50));
console.log('📊 VERIFICATION SUMMARY\n');
console.log(`✅ Passed: ${checks.passed}`);
console.log(`❌ Failed: ${checks.failed}`);
console.log(`⚠️  Warnings: ${checks.warnings}`);
console.log('='.repeat(50));

if (checks.failed === 0 && checks.warnings === 0) {
  console.log('\n🎉 Setup is complete! Ready to generate jobs.');
  console.log('\n📝 Next steps:');
  console.log('   1. Test locally: npm run generate:test');
  console.log('   2. Push to GitHub');
  console.log('   3. Add GitHub Secrets');
  console.log('   4. Enable GitHub Actions\n');
  process.exit(0);
} else if (checks.failed === 0) {
  console.log('\n⚠️  Setup is mostly complete with some warnings.');
  console.log('   Review warnings above and address if needed.\n');
  process.exit(0);
} else {
  console.log('\n❌ Setup incomplete. Please fix the errors above.');
  console.log('\n💡 Common fixes:');
  console.log('   - Missing .env file: cp .env.example .env');
  console.log('   - Missing dependencies: npm install');
  console.log('   - Missing GitHub workflow: Check .github/workflows/ folder\n');
  process.exit(1);
}


