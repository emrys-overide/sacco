const origin = 'http://127.0.0.1:5000';

const spaResponse = await fetch(`${origin}/member-area`);
const spaHtml = await spaResponse.text();
if (spaResponse.status !== 200 || !spaHtml.includes('<div id="root"></div>')) {
  throw new Error(`Expected SPA route to return the Vite entry page, received ${spaResponse.status}.`);
}

const apiResponse = await fetch(`${origin}/api/auth/login`, { method: 'POST' });
if (apiResponse.status !== 404) {
  throw new Error(`Expected API path to remain unavailable in static preview, received ${apiResponse.status}.`);
}

console.log('Static Hosting preview serves SPA routes and does not expose the API.');
