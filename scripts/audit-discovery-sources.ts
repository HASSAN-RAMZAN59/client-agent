import { OsmOverpassDiscoverySource } from '../src/modules/discovery/sources/osm-overpass.source.js';
import { DuckDuckGoSearchDiscoverySource } from '../src/modules/discovery/sources/duckduckgo-search.source.js';
import { generateDiscoveryQueries } from '../src/modules/discovery/query-generator.js';
import { getMarketProfile } from '../src/config/markets.js';
import { getPrismaClient, disconnectDatabase } from '../src/database/client.js';

async function main() {
  const db = getPrismaClient();

  const campaign = await db.campaign.findUnique({
    where: { id: '3331e827-24e5-4da7-847d-a1f318901a4e' },
    include: { runs: true }
  });

  console.log('=== CAMPAIGN UNDER AUDIT ===');
  console.log(JSON.stringify({
    id: campaign?.id,
    name: campaign?.name,
    country: campaign?.country,
    state: campaign?.state,
    city: campaign?.city,
    niche: campaign?.niche,
    targetBusinesses: campaign?.targetBusinesses,
    maxDiscoveryPerRun: campaign?.maxDiscoveryPerRun,
    runs: campaign?.runs,
  }, null, 2));

  console.log('\n=== MARKET PROFILE RESOLUTION ===');
  const market = getMarketProfile(campaign?.country);
  console.log({
    countryCode: market.countryCode,
    countryName: market.countryName,
    adminLevel: market.overpassAreaAdminLevel,
    dialCode: market.dialCode,
    nicheMappingDentist: market.nicheMappings['dentist'],
  });

  console.log('\n=== 1. TESTING OSM / OVERPASS SOURCE ===');
  const osm = new OsmOverpassDiscoverySource();
  console.log('OSM enabled:', osm.enabled, 'status:', osm.status);

  // Generate overpass query manually to inspect
  const tagFilters = ['["amenity"="dentist"]', '["healthcare"="dentist"]'];
  const filterUnion = tagFilters
    .map((tag) => `node${tag}(area.searchArea);\n  way${tag}(area.searchArea);\n  relation${tag}(area.searchArea);`)
    .join('\n  ');
  const adminLevel = market.overpassAreaAdminLevel || '^[4-8]$';
  const overpassQuery = `
[out:json][timeout:15];
area["name"="${campaign?.city}"]["admin_level"~"${adminLevel}"]->.searchArea;
(
  ${filterUnion}
);
out center 30;
`.trim();
  console.log('Generated Overpass Query:\n' + overpassQuery);

  try {
    const osmResults = await osm.discover({
      niche: campaign!.niche,
      city: campaign!.city,
      country: campaign!.country,
      state: campaign!.state || undefined,
      limit: 10,
    });
    console.log(`OSM Returned: ${osmResults.length} businesses`);
    console.log('OSM Metrics:', osm.getMetrics());
    console.log('OSM Status:', osm.status);
    for (const r of osmResults) {
      console.log(` - ${r.name} | ${r.city} | ${r.website || 'NO_WEBSITE'} | ${r.phone || 'NO_PHONE'}`);
    }
  } catch (err: any) {
    console.error('OSM threw error:', err.message);
    console.log('OSM Metrics:', osm.getMetrics());
    console.log('OSM Status:', osm.status);
  }

  console.log('\n=== 2. TESTING DUCKDUCKGO PUBLIC SEARCH SOURCE ===');
  const ddg = new DuckDuckGoSearchDiscoverySource();
  console.log('DDG enabled:', ddg.enabled, 'status:', ddg.status);

  const queries = generateDiscoveryQueries({
    niche: campaign!.niche,
    city: campaign!.city,
    country: campaign!.country,
    state: campaign!.state || undefined,
    maxQueries: 5,
  });
  console.log('Generated DDG Queries:', queries.map(q => q.query));

  try {
    const ddgResults = await ddg.discover({
      niche: campaign!.niche,
      city: campaign!.city,
      country: campaign!.country,
      state: campaign!.state || undefined,
      limit: 10,
    });
    console.log(`DDG Returned: ${ddgResults.length} businesses`);
    console.log('DDG Metrics:', ddg.getMetrics());
    console.log('DDG Status:', ddg.status);
    for (const r of ddgResults) {
      console.log(` - ${r.name} | ${r.city} | ${r.website || 'NO_WEBSITE'} | ${r.phone || 'NO_PHONE'}`);
    }
  } catch (err: any) {
    console.error('DDG threw error:', err.message);
    console.log('DDG Metrics:', ddg.getMetrics());
    console.log('DDG Status:', ddg.status);
  }

  await disconnectDatabase();
}

main().catch(console.error);
