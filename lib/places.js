const API_KEY = () => process.env.GOOGLE_PLACES_API_KEY;
const BASE = 'https://maps.googleapis.com/maps/api/place';

export async function searchPlaces(query) {
  const url = `${BASE}/textsearch/json?query=${encodeURIComponent(query)}&language=ja&key=${API_KEY()}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
    throw new Error(`Places API error: ${data.status}`);
  }
  return (data.results || []).slice(0, 5).map(p => ({
    placeId: p.place_id,
    name: p.name,
    address: p.formatted_address,
  }));
}

export async function getPlaceDetails(placeId) {
  const fields = 'name,url,reviews';
  const url = `${BASE}/details/json?place_id=${placeId}&fields=${fields}&language=ja&key=${API_KEY()}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.status !== 'OK') throw new Error(`Place Details error: ${data.status}`);
  return data.result;
}
