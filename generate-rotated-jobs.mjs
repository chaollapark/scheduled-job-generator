import { config } from 'dotenv';
import mongoose from 'mongoose';
import OpenAI from 'openai';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

config();

const MONGODB_URI = process.env.MONGODB_URI || process.env.MONGO_URI;
const DB_NAME = process.env.MONGODB_DB_NAME || 'test';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// Azure OpenAI configuration (optional alternative provider)
const AZURE_OPENAI_ENDPOINT = process.env.AZURE_OPENAI_ENDPOINT;
const AZURE_OPENAI_API_KEY = process.env.AZURE_OPENAI_API_KEY;
// Support both AZURE_OPENAI_DEPLOYMENT and AZURE_OPENAI_DEPLOYMENT_NAME env keys
const AZURE_OPENAI_DEPLOYMENT = process.env.AZURE_OPENAI_DEPLOYMENT || process.env.AZURE_OPENAI_DEPLOYMENT_NAME; // deployment name
const AZURE_OPENAI_API_VERSION = process.env.AZURE_OPENAI_API_VERSION || '2024-02-15-preview';
const USE_AZURE_OPENAI = !!(AZURE_OPENAI_ENDPOINT && AZURE_OPENAI_API_KEY && AZURE_OPENAI_DEPLOYMENT);

const STATE_FILE = join(__dirname, 'rotation-state.json');
const TOTAL_ENTITIES = 13000;

if (!MONGODB_URI) {
  console.error('❌ MONGODB_URI not found');
  process.exit(1);
}

if (!OPENAI_API_KEY && !USE_AZURE_OPENAI) {
  console.error('❌ No AI provider configured. Set OPENAI_API_KEY or Azure OpenAI vars (AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_API_KEY, AZURE_OPENAI_DEPLOYMENT).');
  process.exit(1);
}

// Initialize OpenAI client (supports Azure OpenAI when configured)
const openai = USE_AZURE_OPENAI
  ? new OpenAI({
      apiKey: AZURE_OPENAI_API_KEY,
      baseURL: `${AZURE_OPENAI_ENDPOINT.replace(/\/$/, '')}/openai/deployments/${AZURE_OPENAI_DEPLOYMENT}`,
      defaultHeaders: { 'api-key': AZURE_OPENAI_API_KEY },
      defaultQuery: { 'api-version': AZURE_OPENAI_API_VERSION }
    })
  : new OpenAI({ apiKey: OPENAI_API_KEY });

// Job Schema
const JobSchema = new mongoose.Schema({
  title: { type: String },
  slug: { type: String, unique: true, sparse: true },
  description: { type: String, required: true },
  companyName: { type: String },
  type: { type: String },
  salary: { type: Number },
  country: { type: String },
  state: { type: String },
  city: { type: String },
  countryId: { type: String },
  stateId: { type: String },
  cityId: { type: String },
  postalCode: { type: Number },
  street: { type: String },
  jobIcon: { type: String },
  contactName: { type: String },
  contactPhone: { type: String },
  contactEmail: { type: String },
  applyLink: { type: String },
  source: { type: String },
  expiresOn: { type: String },
  seniority: { type: String, enum: ["intern", "junior", "mid-level", "senior"], required: true },
  userWorkosId: { type: String },
  plan: { type: String, enum: ['pending', 'basic', 'pro', 'recruiter', 'unlimited'], default: 'pending' },
  blockAIApplications: { type: Boolean, default: true }
}, { timestamps: true });

function generateSlug(title, companyName, id) {
  const processString = (str) =>
    (str || '').toLowerCase().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').trim();
  const titleSlug = processString(title) || 'untitled';
  const companySlug = processString(companyName) || 'unknown-company';
  const shortId = id.slice(-6);
  return `${titleSlug}-at-${companySlug}-${shortId}`;
}

JobSchema.pre('save', function(next) {
  if (this.isModified('title') || this.isModified('companyName') || !this.slug) {
    this.slug = generateSlug(this.title, this.companyName, this._id.toString());
  }
  next();
});

const LobbyingEntitySchema = new mongoose.Schema({}, { collection: 'eu_interest_representatives', strict: false });

function extractDomain(url) {
  try {
    if (!url) return '';
    const urlWithProtocol = url.startsWith('http') ? url : `https://${url}`;
    const domain = new URL(urlWithProtocol).hostname;
    return domain.replace('www.', '');
  } catch {
    return '';
  }
}

function generateHREmail(domain) {
  if (!domain) return '';
  const prefixes = ['hr', 'recruiting', 'careers', 'jobs', 'talent', 'recruitment'];
  return `${prefixes[Math.floor(Math.random() * prefixes.length)]}@${domain}`;
}

function generateApplyLink(domain) {
  return domain ? `https://${domain}/careers` : '';
}

const SENIORITY_CONFIG = {
  'intern': { weight: 30, salaryRange: [18000, 24000], experienceYears: '0', titles: ['Intern', 'Trainee', 'Graduate Intern', 'Policy Intern', 'Research Intern'] },
  'junior': { weight: 35, salaryRange: [35000, 50000], experienceYears: '1-3', titles: ['Junior', 'Associate', 'Analyst', 'Coordinator', 'Officer'] },
  'mid-level': { weight: 25, salaryRange: [50000, 75000], experienceYears: '3-7', titles: ['Senior', 'Manager', 'Lead', 'Specialist', 'Advisor'] },
  'senior': { weight: 10, salaryRange: [75000, 120000], experienceYears: '7+', titles: ['Senior Manager', 'Director', 'Head of', 'Principal', 'Senior Advisor'] }
};

class ParallelRateLimiter {
  constructor(requestsPerSecond = 8) {
    this.requestsPerSecond = requestsPerSecond;
    this.tokens = requestsPerSecond;
    this.lastRefill = Date.now();
    this.queue = [];
  }

  async acquire() {
    return new Promise((resolve) => {
      this.queue.push(resolve);
      this.processQueue();
    });
  }

  processQueue() {
    const now = Date.now();
    const timePassed = now - this.lastRefill;
    const tokensToAdd = Math.floor(timePassed * this.requestsPerSecond / 1000);
    
    if (tokensToAdd > 0) {
      this.tokens = Math.min(this.requestsPerSecond, this.tokens + tokensToAdd);
      this.lastRefill = now;
    }

    while (this.queue.length > 0 && this.tokens > 0) {
      this.tokens--;
      this.queue.shift()();
    }

    if (this.queue.length > 0) {
      setTimeout(() => this.processQueue(), 50);
    }
  }
}

const rateLimiter = new ParallelRateLimiter(8);

function determineSeniorityLevel(entityIndex) {
  const weights = Object.values(SENIORITY_CONFIG).map(c => c.weight);
  const totalWeight = weights.reduce((sum, w) => sum + w, 0);
  const seed = entityIndex % totalWeight;
  let currentWeight = 0;
  
  for (const [seniority, config] of Object.entries(SENIORITY_CONFIG)) {
    currentWeight += config.weight;
    if (seed < currentWeight) return seniority;
  }
  return 'junior';
}

function generateSalary(seniority) {
  const [min, max] = SENIORITY_CONFIG[seniority].salaryRange;
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function generateJobWithGPT(entity, seniority) {
  try {
    await rateLimiter.acquire();
    
    const entityName = entity.name || entity.originalName;
    const config = SENIORITY_CONFIG[seniority];
    const titlePrefix = config.titles[Math.floor(Math.random() * config.titles.length)];
    
    const prompt = `Generate a ${seniority} level job posting for: ${entityName}

Organization details:
- Description: ${entity.description || 'N/A'}
- Goals: ${entity.goals || 'N/A'}
- Focus areas: ${entity.interests?.join(', ') || 'N/A'}
- Category: ${entity.registrationCategory || 'N/A'}

Job requirements:
- Seniority: ${seniority}
- Experience: ${config.experienceYears} years
- Title should include: ${titlePrefix}
- Location: Brussels, Belgium
- Salary: €${config.salaryRange[0].toLocaleString()}-${config.salaryRange[1].toLocaleString()} per year

Create a detailed professional job posting inspired by this structure:

ORGANIZATION OVERVIEW: Brief about the company and its mission (2-3 paragraphs)

YOUR MISSION: What you'll be doing and why it matters (1-2 paragraphs)

KEY RESPONSIBILITIES:
- Lead specific initiatives with measurable outcomes
- Monitor and analyze policy developments
- Build and sustain networks
- Coordinate meetings and stakeholder activities
- [Add 4-6 more specific responsibilities]

DELIVERABLES & KPIs:
- Specific deliverable with quantity and timeline (e.g., "Produce 2 policy briefings monthly")
- Measurable performance metrics (e.g., "Maintain 85% attendance at stakeholder meetings")
- Quantifiable targets (e.g., "Complete 4 research projects quarterly")
- [Add 3-5 more specific KPIs appropriate for ${seniority} level]

REQUIREMENTS:
- ${seniority === 'intern' ? "Bachelor's degree" : seniority === 'junior' ? "Master's degree" : "Master's or PhD"}
- Language: English (C1+) and ${seniority === 'senior' ? 'French/German (C1+)' : 'preferably French or German (B2+)'}
- ${config.experienceYears} years of relevant experience
- Technical proficiency: [Specify tools/software]
- EU work authorization required
- [Add 2-4 more specific requirements]

WHAT WE OFFER:
- Competitive salary: €${config.salaryRange[0].toLocaleString()}-€${config.salaryRange[1].toLocaleString()} per year
- ${seniority === 'intern' ? '6-month internship program starting February 2025' : 'Permanent contract starting Q1 2025'}
- Flexible working hours and hybrid work model (${seniority === 'senior' ? 'flexible arrangement' : '3 days office, 2 days remote'})
- Professional development: €${seniority === 'intern' ? '1,000' : seniority === 'junior' ? '2,500' : seniority === 'mid-level' ? '5,000' : '10,000'} annual training budget
- ${seniority === 'intern' ? '20' : seniority === 'junior' ? '25' : '30'} days annual leave
- Health insurance and ${seniority === 'mid-level' || seniority === 'senior' ? 'performance bonuses' : 'benefits package'}
- Conference attendance and networking opportunities
- [Add 2-3 more specific benefits]

LOGISTICS & APPLICATION:
- Start date: ${seniority === 'intern' ? 'February 2025 (6-month program)' : 'March 2025 (permanent)'}
- Working languages: English and French/German
- Location: Brussels office with hybrid flexibility
- Application deadline: ${new Date(Date.now() + 30*24*60*60*1000).toLocaleDateString('en-GB')}
- Interview process: Application screening → Competency interview → Case study → Final panel
- Decision within 2 weeks of final interview

ABOUT YOU:
- Strong analytical and communication skills
- Strategic mindset with ability to identify opportunities
- ${seniority === 'intern' ? 'Eager to learn' : seniority === 'junior' ? 'Self-motivated' : 'Proven leadership'} and collaborative approach
- Deep knowledge of EU institutions and policy processes
- [Add 2-3 more personal qualities]

This is an exceptional opportunity to ${seniority === 'intern' ? 'launch your career' : seniority === 'junior' ? 'develop your expertise' : 'lead strategic initiatives'} in Brussels' dynamic EU policy ecosystem.

${entityName} is an Equal Opportunity Employer committed to diversity and inclusion.

Please submit your application (CV, cover letter, and policy writing sample) by the deadline above.

Required JSON format:
{
  "title": "Specific job title with ${titlePrefix}",
  "description": "Complete 2500-4000 word description following the structure above with org overview, mission, responsibilities, deliverables & KPIs, requirements, benefits, logistics, and about you sections"
}`;

    const completion = await openai.chat.completions.create({
      // For Azure OpenAI, the SDK uses the deployment via baseURL; we still pass model (deployment name)
      model: USE_AZURE_OPENAI ? AZURE_OPENAI_DEPLOYMENT : "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You are a recruiting copywriter specializing in EU policy jobs. Create comprehensive, detailed job postings inspired by high-quality corporate job ads. Output ONLY valid JSON. No disclaimers, no generic phrases, no emojis. Be specific and concrete with measurable deliverables and KPIs appropriate for ${seniority} level positions. Make descriptions 2500-4000 words with rich detail.`
        },
        { role: "user", content: prompt }
      ],
      temperature: 0.7,
      max_tokens: 4000,
    });

    const response = completion.choices[0]?.message?.content;
    if (!response) throw new Error('No response from GPT');

    const cleanResponse = response.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    return JSON.parse(cleanResponse);
  } catch (error) {
    console.error(`❌ GPT generation failed: ${error.message}`);
    return null;
  }
}

function generateJobTemplate(entity, seniority) {
  const entityName = entity.name || entity.originalName;
  const config = SENIORITY_CONFIG[seniority];
  const titlePrefix = config.titles[Math.floor(Math.random() * config.titles.length)];
  
  const title = `${titlePrefix} - ${entity.registrationCategory || 'EU Affairs'} at ${entityName}`;
  
  const description = `${entityName} is seeking a ${seniority} level professional for an exciting opportunity in Brussels, Belgium.

ABOUT ${entityName}:
${entity.description || `${entityName} is a leading organization in the EU policy landscape, committed to excellence in ${entity.registrationCategory || 'public affairs'}.`}

YOUR MISSION:
As ${titlePrefix}, you will play a key role in our Brussels operations, contributing to ${entity.goals || 'our strategic objectives'} with focus on ${entity.interests?.slice(0, 3).join(', ') || 'EU policy engagement'}.

KEY RESPONSIBILITIES:
- Lead policy analysis and advocacy initiatives with measurable impact
- Monitor and report on EU legislative and regulatory developments
- Build and maintain relationships with key EU stakeholders
- Coordinate meetings, events, and stakeholder consultations
- Contribute to organizational strategy and business development
- Represent the organization in EU forums and working groups

DELIVERABLES & KPIs:
- Produce ${seniority === 'intern' ? '2 policy briefings monthly' : seniority === 'junior' ? '3 policy analyses quarterly' : seniority === 'mid-level' ? '5 major policy campaigns annually' : '10+ strategic initiatives per year'}
- Achieve ${seniority === 'intern' ? '85%' : seniority === 'junior' ? '90%' : '95%'}+ stakeholder satisfaction ratings
- Maintain consistent engagement with ${seniority === 'intern' ? '10+' : seniority === 'junior' ? '15+' : seniority === 'mid-level' ? '25+' : '50+'} key stakeholders
- Complete deliverables with ${seniority === 'intern' ? '90%' : '95%'}+ accuracy rate

REQUIREMENTS:
- ${seniority === 'intern' ? "Bachelor's degree" : "Master's degree or higher"} in Political Science, European Studies, Law, or related field
- ${config.experienceYears} years of professional experience in EU policy or related field
- Fluent English (C1+) and preferably French or German (B2+)
- Strong analytical, communication, and organizational skills
- Proficiency in EU databases, CRM systems, and Microsoft Office
- EU work authorization required

WHAT WE OFFER:
- Competitive salary: €${config.salaryRange[0].toLocaleString()}-€${config.salaryRange[1].toLocaleString()} per year
- ${seniority === 'intern' ? '6-month internship starting February 2025' : 'Permanent contract starting March 2025'}
- Flexible working hours with hybrid work model
- Professional development budget and training opportunities
- ${seniority === 'intern' ? '20' : seniority === 'junior' ? '25' : '30'} days annual leave
- Health insurance and benefits package
- Conference attendance and networking opportunities

LOGISTICS:
- Location: Brussels, Belgium (hybrid: ${seniority === 'senior' ? 'flexible' : '3 days office, 2 days remote'})
- Working languages: English and French/German
- Start date: ${seniority === 'intern' ? 'February 2025' : 'March 2025'}
- Application deadline: ${new Date(Date.now() + 30*24*60*60*1000).toLocaleDateString('en-GB')}

This is an excellent opportunity to ${seniority === 'intern' ? 'gain valuable experience' : seniority === 'junior' ? 'develop your career' : 'make strategic impact'} in Brussels' vibrant EU policy ecosystem.

${entityName} is an Equal Opportunity Employer committed to diversity and inclusion.

Please submit your application (CV and cover letter) by the deadline above.`;
  
  return { title, description };
}

async function processEntity(entity, entityIndex) {
  const entityName = entity.name || entity.originalName;
  
  try {
    const seniority = determineSeniorityLevel(entityIndex);
    const domain = extractDomain(entity.webSiteURL);
    
    let jobData = await generateJobWithGPT(entity, seniority);
    let gptSuccess = !!jobData;
    
    if (!jobData) {
      jobData = generateJobTemplate(entity, seniority);
    }

    const salary = generateSalary(seniority);
    const jobRecord = {
      title: jobData.title,
      description: jobData.description,
      companyName: entityName,
      seniority: seniority,
      type: 'Full-time',
      remote: 'Hybrid',
      country: 'Belgium',
      city: 'Brussels',
      state: '',
      countryId: 'BE',
      stateId: '',
      cityId: 'brussels',
      postalCode: '1000',
      street: '',
      contactEmail: generateHREmail(domain),
      applyLink: generateApplyLink(domain),
      plan: 'basic',
      source: 'scheduled-rotated-generator',
      blockAIApplications: false,
      salary: salary,
      slug: generateSlug(jobData.title, entityName, entity._id.toString()),
    };

    return { success: true, jobRecord, seniority, gptSuccess, entityName };
  } catch (error) {
    return { success: false, error: error.message, entityName, seniority: null, gptSuccess: false };
  }
}

// State management
function loadState() {
  if (existsSync(STATE_FILE)) {
    const data = readFileSync(STATE_FILE, 'utf8');
    return JSON.parse(data);
  }
  return { currentIndex: 0, lastRun: null, totalGenerated: 0 };
}

function saveState(state) {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

async function generateRotatedJobs(count) {
  console.log(`🚀 === SCHEDULED ROTATED JOB GENERATION ===\n`);
  console.log(`📊 Generating ${count} jobs with rotation through ${TOTAL_ENTITIES} entities`);
  
  const state = loadState();
  console.log(`📍 Starting from entity index: ${state.currentIndex}`);
  console.log(`📈 Total jobs generated historically: ${state.totalGenerated}\n`);

  const stats = {
    total: 0,
    processed: 0,
    successful: 0,
    failed: 0,
    gptSuccessful: 0,
    templateFallback: 0,
    startTime: Date.now(),
    bySeniority: { 'intern': 0, 'junior': 0, 'mid-level': 0, 'senior': 0 }
  };

  try {
    await mongoose.connect(MONGODB_URI, { bufferCommands: false, dbName: DB_NAME });
    console.log('✅ Connected to database\n');
    
    const JobModel = mongoose.models?.Job || mongoose.model('Job', JobSchema);
    const LobbyingEntityModel = mongoose.models?.LobbyingEntity || mongoose.model('LobbyingEntity', LobbyingEntitySchema);
    
    // Get entities starting from current index
    const entities = await LobbyingEntityModel.find({
      $or: [
        { name: { $exists: true, $ne: '' } },
        { originalName: { $exists: true, $ne: '' } }
      ],
      webSiteURL: { $exists: true, $ne: '' }
    })
    .skip(state.currentIndex)
    .limit(count)
    .lean();

    stats.total = entities.length;
    console.log(`✅ Found ${stats.total} entities to process\n`);

    if (stats.total === 0) {
      console.log('⚠️  Reached end of entities, resetting to beginning');
      state.currentIndex = 0;
      saveState(state);
      return stats;
    }

    // Process in batches
    const batchSize = 50;
    const concurrency = 10;
    const totalBatches = Math.ceil(stats.total / batchSize);

    for (let i = 0; i < stats.total; i += batchSize) {
      const batch = entities.slice(i, i + batchSize);
      const batchNum = Math.floor(i / batchSize) + 1;
      
      console.log(`\n📦 Batch ${batchNum}/${totalBatches} (jobs ${i + 1}-${Math.min(i + batchSize, stats.total)})`);
      
      const promises = [];
      for (let j = 0; j < batch.length; j += concurrency) {
        const chunk = batch.slice(j, j + concurrency);
        const chunkPromises = chunk.map((entity, idx) => 
          processEntity(entity, state.currentIndex + i + j + idx)
        );
        promises.push(Promise.all(chunkPromises));
      }
      
      const results = (await Promise.all(promises)).flat();
      const jobsToInsert = [];
      
      for (const result of results) {
        stats.processed++;
        
        if (result.success) {
          stats.successful++;
          stats.bySeniority[result.seniority]++;
          result.gptSuccess ? stats.gptSuccessful++ : stats.templateFallback++;
          jobsToInsert.push(result.jobRecord);
        } else {
          stats.failed++;
          console.log(`   ❌ Error: ${result.entityName}: ${result.error}`);
        }
      }
      
      if (jobsToInsert.length > 0) {
        try {
          await JobModel.insertMany(jobsToInsert, { ordered: false });
        } catch (error) {
          console.log(`   ⚠️  Some jobs may have failed: ${error.message}`);
        }
      }
      
      const elapsed = (Date.now() - stats.startTime) / 1000 / 60;
      console.log(`   ✅ Batch ${batchNum} complete - Success: ${results.filter(r => r.success).length}`);
      console.log(`   ⏱️  Elapsed: ${elapsed.toFixed(1)}m, Rate: ${(stats.processed / elapsed).toFixed(1)} jobs/min`);
    }

    // Update state
    state.currentIndex = (state.currentIndex + stats.successful) % TOTAL_ENTITIES;
    state.lastRun = new Date().toISOString();
    state.totalGenerated += stats.successful;
    saveState(state);

    console.log('\n🎉 === GENERATION COMPLETE ===');
    console.log(`✅ Successful: ${stats.successful}/${stats.processed}`);
    console.log(`🤖 GPT: ${stats.gptSuccessful}, Template: ${stats.templateFallback}`);
    console.log(`⏱️  Total time: ${((Date.now() - stats.startTime) / 1000 / 60).toFixed(1)} minutes`);
    console.log(`\n📊 By Seniority:`);
    Object.entries(stats.bySeniority).forEach(([level, count]) => {
      console.log(`   ${level}: ${count} jobs`);
    });
    console.log(`\n📍 Next run will start from entity index: ${state.currentIndex}`);
    console.log(`📈 Total jobs generated all-time: ${state.totalGenerated}`);

    return stats;

  } catch (error) {
    console.error('❌ Generation failed:', error.message);
    throw error;
  } finally {
    await mongoose.disconnect();
    console.log('\n🔌 Database connection closed.');
  }
}

// CLI
const args = process.argv.slice(2);
const count = args[0] ? parseInt(args[0]) : 2000;

console.log(`🚀 SCHEDULED ROTATED JOB GENERATION`);
console.log(`📊 Generating ${count} jobs`);
console.log(`🔄 Rotation through ${TOTAL_ENTITIES} total entities`);
console.log(`💰 Estimated cost: $${(count * 0.003).toFixed(2)} USD`);
console.log(`⏱️  Estimated time: ${Math.ceil(count / 20)} minutes\n`);
console.log('Starting in 3 seconds...\n');

setTimeout(() => {
  generateRotatedJobs(count)
    .then((stats) => {
      console.log('\n✅ GENERATION COMPLETED SUCCESSFULLY!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ GENERATION FAILED:', error);
      process.exit(1);
    });
}, 3000);


