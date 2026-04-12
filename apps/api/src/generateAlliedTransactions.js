require("./loadEnv");
const fs = require("fs");
const path = require("path");
const { initDb, query, tx, hasDbConfig } = require("./db");
const {
  alliedConfig,
  fetchSiteProfiles,
  loadSampleSiteProfiles,
  replaceTransactionsForSites,
  buildRecordsForSite
} = require("./alliedTransactions");

function parseArgs(argv) {
  const options = {
    seed: alliedConfig.seed,
    recordsPerSite: alliedConfig.recordsPerSite,
    days: alliedConfig.dateWindowDays,
    siteIds: [],
    output: "",
    sample: false,
    seedDb: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--seed") options.seed = Number(argv[++index]);
    else if (arg === "--count") options.recordsPerSite = Number(argv[++index]);
    else if (arg === "--days") options.days = Number(argv[++index]);
    else if (arg === "--site") options.siteIds.push(argv[++index]);
    else if (arg === "--output") options.output = argv[++index];
    else if (arg === "--sample") options.sample = true;
    else if (arg === "--seed-db") options.seedDb = true;
    else if (arg === "--date-from") options.startDate = argv[++index];
    else if (arg === "--date-to") options.endDate = argv[++index];
  }

  if (!options.startDate || !options.endDate) {
    const end = new Date();
    const start = new Date(end.getTime() - options.days * 24 * 60 * 60 * 1000);
    options.startDate = start.toISOString();
    options.endDate = end.toISOString();
  }

  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  let siteProfiles = [];

  if (options.sample || !hasDbConfig()) {
    siteProfiles = loadSampleSiteProfiles();
    if (options.siteIds.length > 0) {
      const requested = new Set(options.siteIds);
      siteProfiles = siteProfiles.filter((site) => requested.has(site.id));
    }
  } else {
    await initDb();
    siteProfiles = await fetchSiteProfiles({ query }, options.siteIds);
  }

  if (siteProfiles.length === 0) {
    throw new Error("No sites available for Allied transaction generation.");
  }

  let records;
  if (options.seedDb) {
    if (!hasDbConfig()) {
      throw new Error("Database seeding requires DATABASE_URL.");
    }
    records = await tx((client) =>
      replaceTransactionsForSites(client, siteProfiles, {
        seed: options.seed,
        recordsPerSite: options.recordsPerSite,
        startDate: options.startDate,
        endDate: options.endDate
      })
    );
  } else {
    records = siteProfiles.flatMap((site) =>
      buildRecordsForSite(site, {
        seed: options.seed,
        recordsPerSite: options.recordsPerSite,
        startDate: options.startDate,
        endDate: options.endDate
      })
    );
  }

  const payload = JSON.stringify(records, null, 2);
  if (options.output) {
    const resolved = path.resolve(options.output);
    fs.writeFileSync(resolved, payload);
    console.log(`Wrote ${records.length} Allied transactions to ${resolved}`);
    return;
  }

  console.log(payload);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
