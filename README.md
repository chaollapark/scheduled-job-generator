# Scheduled Job Generator with Rotation

A self-contained automated job generation system that runs on GitHub Actions cron schedule, generating 2000 jobs at 9:00 AM and 2000 jobs at 13:00 PM daily, rotating through 13,000+ EU lobbying entities.

## 🎯 Features

- **Automated Scheduling**: Runs twice daily via GitHub Actions (9:00 AM and 1:00 PM UTC)
- **Smart Rotation**: Automatically rotates through 13,000+ entities, never duplicating
- **State Persistence**: Tracks current position in rotation using `rotation-state.json`
- **Detailed Job Descriptions**: Generates comprehensive job postings inspired by high-quality corporate job ads (like DNV)
- **Mixed Seniority Levels**: Distributes jobs across intern (30%), junior (35%), mid-level (25%), and senior (10%)
- **Organization Context**: Uses real organization descriptions, goals, and focus areas
- **GPT-Powered**: Leverages OpenAI GPT-4o-mini for rich, detailed job descriptions (2500-4000 words)

## 📋 Job Description Structure

Each generated job includes:

1. **Organization Overview**: About the company and its mission
2. **Your Mission**: Role purpose and impact
3. **Key Responsibilities**: 6-8 specific responsibilities with measurable outcomes
4. **Deliverables & KPIs**: Concrete metrics like "Produce 2 policy briefings monthly", "Maintain 85% stakeholder satisfaction"
5. **Requirements**: Education, experience, languages, technical skills, work authorization
6. **What We Offer**: Salary, benefits, professional development, training budgets, conferences
7. **Logistics & Application**: Start date, working languages, hybrid policy, interview process
8. **About You**: Personal qualities and competencies needed

### Example Job Elements (Inspired by DNV):

- **Concrete KPIs**: "Achieve 85%+ policy objective success rate"
- **Specific Budgets**: "€10,000 annual executive development budget"
- **Timeline Details**: "6-month internship starting February 2025" or "Permanent contract Q1 2025"
- **Hybrid Details**: "3 days office, 2 days remote" or "Flexible arrangement"
- **Career Development**: Training budgets (€1,000-€10,000 depending on seniority)
- **Networking**: "Attendance at 4 international conferences annually"

## 🔄 Rotation System

The system maintains continuity across runs:

- **Day 1 (9 AM)**: Generates jobs 1-2000
- **Day 1 (1 PM)**: Generates jobs 2001-4000
- **Day 2 (9 AM)**: Generates jobs 4001-6000
- **Day 2 (1 PM)**: Generates jobs 6001-8000
- **Day 3+**: Continues rotating...
- **After ~13,000**: Automatically resets to beginning

State is tracked in `rotation-state.json`:
```json
{
  "currentIndex": 4000,
  "lastRun": "2025-10-12T13:00:00.000Z",
  "totalGenerated": 4000
}
```

## 🚀 Setup Instructions

### 1. Prerequisites

- GitHub account with a repository
- MongoDB database with `eu_interest_representatives` collection
- OpenAI API key

### 2. Installation

```bash
# Navigate to the folder
cd scheduled-job-generator

# Install dependencies
npm install
```

### 3. Configure Environment Variables

Create a `.env` file based on `.env.example`:

```bash
cp .env.example .env
```

Edit `.env` with your credentials (either OpenAI or Azure OpenAI):
```env
MONGODB_URI=mongodb+srv://your-username:your-password@cluster.mongodb.net/
MONGODB_DB_NAME=your_database_name

# Option A: OpenAI (non-Azure)
OPENAI_API_KEY=sk-proj-your-actual-key

# Option B: Azure OpenAI (alternative provider)
# If the Azure vars below are set, the generator will use Azure
# Ensure the deployment is a chat-completions capable model
# Example endpoint: https://your-resource-name.openai.azure.com
AZURE_OPENAI_ENDPOINT=
AZURE_OPENAI_API_KEY=
AZURE_OPENAI_DEPLOYMENT=
# Optional, defaults to 2024-02-15-preview
AZURE_OPENAI_API_VERSION=2024-02-15-preview
```

### 4. GitHub Secrets Configuration

Add these secrets to your GitHub repository:

1. Go to: **Settings** → **Secrets and variables** → **Actions**
2. Add repository secrets (choose OpenAI or Azure OpenAI):
   - `MONGODB_URI`: Your MongoDB connection string
   - `MONGODB_DB_NAME`: Your database name (e.g., `test`)
   - Option A (OpenAI):
     - `OPENAI_API_KEY`
   - Option B (Azure OpenAI):
     - `AZURE_OPENAI_ENDPOINT` (e.g., https://your-resource-name.openai.azure.com)
     - `AZURE_OPENAI_API_KEY`
     - `AZURE_OPENAI_DEPLOYMENT` (deployment name of your chat model)
     - `AZURE_OPENAI_API_VERSION` (optional)

### 5. Enable GitHub Actions

1. Push this folder to your GitHub repository
2. Go to **Actions** tab
3. Enable workflows if prompted
4. The workflow will run automatically at:
   - **9:00 AM UTC** (2000 jobs)
   - **1:00 PM UTC** (2000 jobs)

### 6. Manual Trigger (Optional)

You can manually trigger the workflow:

1. Go to **Actions** → **Generate Rotated Jobs**
2. Click **Run workflow**
3. Optionally specify custom job count (default: 2000)

## 💻 Local Usage

### Generate Jobs Locally

```bash
# Generate 2000 jobs (default)
npm run generate

# Generate custom amount
node generate-rotated-jobs.mjs 500

# Test with 10 jobs
npm run generate:test
```

### Reset Rotation State

```bash
# Reset to beginning (index 0)
npm run reset-state
```

### View Current State

```bash
cat rotation-state.json
```

## 📊 Job Distribution

### Seniority Levels

- **Intern (30%)**: €18,000-24,000/year, 0 years experience
- **Junior (35%)**: €35,000-50,000/year, 1-3 years experience
- **Mid-level (25%)**: €50,000-75,000/year, 3-7 years experience
- **Senior (10%)**: €75,000-120,000/year, 7+ years experience

### Job Details

- **Location**: Brussels, Belgium
- **Type**: Full-time, Hybrid
- **Language**: English + French/German
- **Source**: `scheduled-rotated-generator`
- **Plan**: Basic tier

## 🔧 Configuration

### Modify Schedule

Edit `.github/workflows/generate-jobs.yml`:

```yaml
on:
  schedule:
    # Change times here (UTC timezone)
    - cron: '0 9 * * *'   # 9:00 AM UTC
    - cron: '0 13 * * *'  # 1:00 PM UTC
```

**Time Zone Conversion Examples:**
- 9:00 AM UTC = 10:00 AM CET / 11:00 AM CEST
- 1:00 PM UTC = 2:00 PM CET / 3:00 PM CEST

### Adjust Job Count

Change default in the script or workflow:

```javascript
// In generate-rotated-jobs.mjs
const count = args[0] ? parseInt(args[0]) : 2000; // Change 2000 to desired count
```

Or in workflow:
```yaml
run: node generate-rotated-jobs.mjs 3000  # Change 2000 to 3000
```

### Modify Concurrency/Rate Limits

```javascript
// In generate-rotated-jobs.mjs
const rateLimiter = new ParallelRateLimiter(8); // Adjust requests per second
const concurrency = 10; // Adjust parallel processing
```

## 📈 Monitoring

### Check Workflow Runs

1. Go to **Actions** tab in GitHub
2. View run history and logs
3. Download artifacts for detailed logs

### View Statistics

After each run, logs show:
```
✅ Successful: 1998/2000
🤖 GPT: 1850, Template: 148
⏱️  Total time: 25.5 minutes
📊 By Seniority:
   intern: 599 jobs
   junior: 701 jobs
   mid-level: 499 jobs
   senior: 199 jobs
📍 Next run will start from entity index: 4000
📈 Total jobs generated all-time: 4000
```

### Database Verification

Query MongoDB to check generated jobs:
```javascript
db.jobs.countDocuments({ source: 'scheduled-rotated-generator' })
```

## 💰 Cost Estimation

### Per Run (2000 jobs)
- **OpenAI API**: ~$6-8 USD (GPT-4o-mini at ~$0.003-0.004/job)
- **Azure OpenAI**: Similar, depends on your region/tier and deployment pricing
- **GitHub Actions**: Free (within limits)
- **MongoDB**: Depends on your plan

### Daily Cost (4000 jobs)
- **OpenAI**: ~$12-16 USD/day
- **Monthly**: ~$360-480 USD/month

### Cost Optimization Tips

1. **Reduce fallback to templates**: Improve prompts to increase GPT success rate
2. **Adjust rate limits**: Balance between speed and reliability
3. **Use shorter descriptions**: Reduce max_tokens if needed
4. **Batch processing**: Already optimized with parallel processing

## 🛠️ Troubleshooting

### Jobs Not Generating

1. Check GitHub Actions logs
2. Verify secrets are set correctly
3. Check MongoDB connection
4. Verify OpenAI API key and credits

### Rate Limit Errors

- Reduce concurrency in script
- Lower rate limiter requests per second
- Add delays between batches

### State File Issues

If rotation state gets corrupted:
```bash
npm run reset-state
```

### Duplicate Jobs

The script uses entity skip logic and unique slugs to prevent duplicates. If you see duplicates:
1. Check `rotation-state.json` for correct index
2. Verify database unique index on slug field
3. Clear and regenerate if needed

## 📝 Files Overview

```
scheduled-job-generator/
├── .github/
│   └── workflows/
│       └── generate-jobs.yml       # GitHub Actions cron workflow
├── generate-rotated-jobs.mjs       # Main generation script
├── rotation-state.json             # Tracks rotation position
├── package.json                    # Dependencies and scripts
├── .env.example                    # Environment template
├── .gitignore                      # Git ignore rules
└── README.md                       # This file
```

## 🔐 Security

- **Never commit** `.env` file to git
- Use **GitHub Secrets** for sensitive data in workflows
- Rotate API keys regularly
- Monitor API usage for anomalies
- Use read-only MongoDB credentials if possible

## 🚦 Quick Start Checklist

- [ ] Install dependencies: `npm install`
- [ ] Create `.env` with credentials
- [ ] Test locally: `npm run generate:test`
- [ ] Push to GitHub repository
- [ ] Add GitHub Secrets (MONGODB_URI, MONGODB_DB_NAME, OPENAI_API_KEY)
- [ ] Enable GitHub Actions
- [ ] Verify first scheduled run
- [ ] Monitor logs and database

## 📞 Support

For issues or questions:
1. Check GitHub Actions logs
2. Review error messages in console output
3. Verify environment variables
4. Check MongoDB and OpenAI API status
5. Review `rotation-state.json` for current position

## 📜 License

ISC

## 🎉 Success Metrics

The system successfully:
- ✅ Generates 4,000 jobs daily (2,000 per run)
- ✅ Rotates through all 13,000+ entities
- ✅ Creates detailed, high-quality job descriptions
- ✅ Maintains state across runs
- ✅ Distributes jobs across all seniority levels
- ✅ Includes comprehensive job details (KPIs, logistics, benefits)
- ✅ Runs automatically without manual intervention

---

**Last Updated**: October 2025


