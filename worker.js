/**
 * CJX Real Estate lead endpoint.
 * The FUB API key is stored only in Cloudflare as the CRM secret.
 */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/videos' && request.method === 'GET') return latestVideos();
    if (url.pathname !== '/api/lead') return env.ASSETS.fetch(request);
    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });

    try {
      if (!env.CRM) return json({ error: 'The CRM secret is not available to the production site.' }, 500);
      const data = await request.json();
      if (!data.name && !data.email) return json({ error: 'Name or email is required.' }, 400);

      const [firstName = '', ...lastName] = String(data.name || '').trim().split(/\s+/);
      const person = {
        firstName,
        lastName: lastName.join(' '),
        ...(data.email ? { emails: [{ value: String(data.email) }] } : {}),
        ...(data.phone ? { phones: [{ value: String(data.phone) }] } : {})
      };
      const messageParts = [
        data.message && `Message: ${data.message}`,
        data.address && `Property address: ${data.address}`,
        data.propertyAddress && `Listing: ${data.propertyAddress}`,
        data.pageUrl && `Page: ${data.pageUrl}`
      ].filter(Boolean);
      const payload = {
        source: 'cjxrealty.com',
        system: 'CJX Website',
        type: data.type || 'General Inquiry',
        message: messageParts.join('\n'),
        person
      };
      const authorization = `Basic ${btoa(`${env.CRM}:`)}`;
      const fub = await fetch('https://api.followupboss.com/v1/events', {
        method: 'POST',
        headers: { Authorization: authorization, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!fub.ok) {
        console.error('FUB rejected lead', fub.status, await fub.text());
        return json({ error: `Follow Up Boss rejected the submission (${fub.status}).` }, 502);
      }
      return json({ ok: true });
    } catch (error) {
      console.error('Lead endpoint failed', error);
      return json({ error: 'Unable to submit lead.' }, 500);
    }
  }
};

function json(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
}

async function latestVideos() {
  const channelId = 'UCSk96f2InocpjuqKIFLQS1A';
  const response = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`);
  if (!response.ok) return json({ error: 'Unable to load videos.' }, 502);
  const xml = await response.text();
  const videos = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].slice(0, 4).map((match) => {
    const entry = match[1];
    const read = (pattern) => decodeXml((entry.match(pattern) || ['', ''])[1]);
    const videoId = read(/<yt:videoId>([^<]+)<\/yt:videoId>/);
    return {
      title: read(/<title>([\s\S]*?)<\/title>/),
      url: `https://www.youtube.com/watch?v=${videoId}`,
      thumbnail: (entry.match(/<media:thumbnail url="([^"]+)"/) || ['', ''])[1],
      published: new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(read(/<published>([^<]+)<\/published>/)))
    };
  }).filter((video) => video.url && video.thumbnail);
  return new Response(JSON.stringify(videos), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=600' } });
}

function decodeXml(value) {
  return value.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}
