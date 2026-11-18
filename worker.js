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
        data.preferredTime && `Best time to connect: ${data.preferredTime}`,
        data.address && `Property address: ${data.address}`,
        data.propertyAddress && `Listing: ${data.propertyAddress}`,
        data.pageUrl && `Page: ${data.pageUrl}`,
        data.gclid && `Google click ID: ${data.gclid}`,
        data.utmSource && `UTM source: ${data.utmSource}`,
        data.utmMedium && `UTM medium: ${data.utmMedium}`,
        data.utmCampaign && `UTM campaign: ${data.utmCampaign}`
      ].filter(Boolean);
      const payload = {
        source: data.gclid || data.utmSource === 'google'
          ? 'Google Ads - 1717 E Union Hills'
          : 'cjxrealty.com',
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

// Settle In AZ (youtube.com/@SettleInAZ). YouTube publishes a separate feed for a
// channel's long-form videos (playlist UULF…) and for its Shorts (playlist UUSH…),
// so the site can always show the newest 2 of each instead of only the newest 4 uploads.
const YOUTUBE_CHANNEL_ID = 'UCpCx7oWIWL8Z2WjOT6qhHAg';
const LONG_FORM_COUNT = 2;
const SHORTS_COUNT = 2;

async function latestVideos() {
  const base = YOUTUBE_CHANNEL_ID.slice(2);
  const [longForm, shorts] = await Promise.all([
    readFeed(`playlist_id=UULF${base}`, 'video'),
    readFeed(`playlist_id=UUSH${base}`, 'short')
  ]);

  // Normally 2 + 2. If one feed is short on videos (or fails), fill from the other so there are still 4 cards.
  const total = LONG_FORM_COUNT + SHORTS_COUNT;
  const pickedLong = longForm.slice(0, Math.max(LONG_FORM_COUNT, total - Math.min(shorts.length, SHORTS_COUNT)));
  const pickedShorts = shorts.slice(0, total - pickedLong.length);
  let videos = [...pickedLong, ...pickedShorts];

  // Last resort: the channel's combined uploads feed.
  if (!videos.length) videos = (await readFeed(`channel_id=${YOUTUBE_CHANNEL_ID}`, 'video')).slice(0, total);
  if (!videos.length) return json({ error: 'Unable to load videos.' }, 502);

  return new Response(JSON.stringify(videos), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=900' }
  });
}

async function readFeed(query, kind) {
  try {
    const response = await fetch(`https://www.youtube.com/feeds/videos.xml?${query}`, { cf: { cacheTtl: 900, cacheEverything: true } });
    if (!response.ok) return [];
    const xml = await response.text();
    return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map((match) => {
      const entry = match[1];
      const read = (pattern) => decodeXml((entry.match(pattern) || ['', ''])[1]);
      const videoId = read(/<yt:videoId>([^<]+)<\/yt:videoId>/);
      if (!videoId) return null;
      return {
        kind,
        title: read(/<title>([\s\S]*?)<\/title>/),
        url: kind === 'short' ? `https://www.youtube.com/shorts/${videoId}` : `https://www.youtube.com/watch?v=${videoId}`,
        // Shorts get YouTube's vertical thumbnail; long-form videos get the standard one.
        thumbnail: kind === 'short' ? `https://i.ytimg.com/vi/${videoId}/oar2.jpg` : `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
        fallbackThumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
        published: new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/Phoenix' })
          .format(new Date(read(/<published>([^<]+)<\/published>/)))
      };
    }).filter(Boolean);
  } catch (error) {
    console.error('YouTube feed failed', query, error);
    return [];
  }
}

function decodeXml(value) {
  return value.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}
