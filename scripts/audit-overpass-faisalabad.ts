async function inspectOverpass() {
  const queryArea = `
[out:json][timeout:15];
relation["name"="Faisalabad"];
out tags;
`;
  const res = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'TestAudit/1.0' },
    body: `data=${encodeURIComponent(queryArea)}`
  });
  console.log('Relation Faisalabad status:', res.status);
  const data = await res.json();
  console.log('Relation Faisalabad tags:', JSON.stringify(data.elements.map((e: any) => ({ id: e.id, tags: e.tags })), null, 2));

  // Let's also check node/way/relation with amenity=dentist in Pakistan or Faisalabad
  const queryDentists = `
[out:json][timeout:15];
(
  node["amenity"="dentist"](31.35,73.0,31.5,73.2);
  way["amenity"="dentist"](31.35,73.0,31.5,73.2);
  node["healthcare"="dentist"](31.35,73.0,31.5,73.2);
  node["amenity"="clinic"](31.35,73.0,31.5,73.2);
  node["amenity"="hospital"](31.35,73.0,31.5,73.2);
);
out center 10;
`;
  const res2 = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'TestAudit/1.0' },
    body: `data=${encodeURIComponent(queryDentists)}`
  });
  const data2 = await res2.json();
  console.log('Dentists/clinics bounding box count in Faisalabad:', data2.elements?.length);
  console.log('Elements:', JSON.stringify(data2.elements?.map((e: any) => ({ id: e.id, tags: e.tags })), null, 2));
}

inspectOverpass().catch(console.error);
