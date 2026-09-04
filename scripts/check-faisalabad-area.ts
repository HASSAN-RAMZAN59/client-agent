async function checkArea() {
  const query = `
[out:json][timeout:15];
(
  area["name"="Faisalabad"];
  area["name:en"="Faisalabad"];
);
out;
`;
  const res = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'TestAudit/1.0' },
    body: `data=${encodeURIComponent(query)}`
  });
  const data = await res.json();
  console.log('Areas matching Faisalabad:', data.elements?.length);
  console.log('Areas:', data.elements);

  // Let's also check place=city
  const queryPlace = `
[out:json][timeout:15];
node["name"~"Faisalabad",i]["place"];
out;
`;
  const resPlace = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'TestAudit/1.0' },
    body: `data=${encodeURIComponent(queryPlace)}`
  });
  const dataPlace = await resPlace.json();
  console.log('Place nodes for Faisalabad:', dataPlace.elements);
}

checkArea().catch(console.error);
