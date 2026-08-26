/**
 * CJX Real Estate lead endpoint.
 * The FUB API key is stored only in Cloudflare as the CRM secret.
 */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname !== '/api/lead') return env.ASSETS.fetch(request);
    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });

    try {
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
        return json({ error: 'Unable to submit lead.' }, 502);
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
